using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using Task = System.Threading.Tasks.Task;
using Microsoft.AspNetCore.Http;
using SenseNet.Configuration;
using SenseNet.ContentRepository;
using SenseNet.ContentRepository.Storage;
using SenseNet.ContentRepository.Storage.Security;
using StorageDataType = SenseNet.ContentRepository.Storage.Schema.DataType;
using PermissionType = SenseNet.ContentRepository.Storage.Security.PermissionType;

namespace Timeline.Theories.M0.Security;

/// <summary>
/// Fixed project image policy. Metadata reads below follow explicit original-
/// caller authorization, use fixed IDs, never enter SystemAccount, and bypass
/// cached relation data. No owner handler/reference traversal is needed.
/// </summary>
internal static class ImageAssetPolicy
{
    internal const string ProjectPath = "/Root/Content/timelines";
    internal const string AssetsPath = ProjectPath + "/ImageAssets";
    private static readonly SemaphoreSlim MutationGate = new(1, 1);
    private static readonly AsyncLocal<bool> InsideMutation = new();
    private static readonly object NoStoreKey = new();
    private static readonly object ReadDeniedKey = new();

    private static void AssertExtensionReady()
    {
        if (!ImageAssetHostingStartup.ConfigureInvoked) throw Invalid();
        if (!ImageAssetHostingStartup.ServicesConfigured) throw Invalid();
        if (!Providers.Instance.NodeObservers.Any(observer => observer is ImageAssetScopeObserver)) throw Invalid();
        if (Providers.Instance.Services.GetService(typeof(IHttpContextAccessor)) is not IHttpContextAccessor) throw Invalid();
    }

    internal static async Task MutateAsync(Func<Task> action, CancellationToken cancel)
    {
        // Stock Image.OnCreated can save dimensions recursively in this flow.
        if (InsideMutation.Value) { await action().ConfigureAwait(false); return; }
        await MutationGate.WaitAsync(cancel).ConfigureAwait(false);
        try { InsideMutation.Value = true; await action().ConfigureAwait(false); }
        finally { InsideMutation.Value = false; MutationGate.Release(); }
    }

    internal static void Permission(int id, PermissionType permission)
    {
        if (id <= 0 || !Has(id, permission))
            throw new SenseNetSecurityException("M0 image asset access is not permitted.");
    }

    private static bool Has(int id, PermissionType permission) =>
        Providers.Instance.SecurityHandler.HasPermission(
            AccessProvider.Current.GetOriginalUser(), id, permission);

    internal static void AssertOpen(Node node)
    {
        EnforceNoStore();
        try { AssertOpenCore(node); }
        catch (SenseNetSecurityException)
        {
            var context = CurrentHttpContext();
            if (context is not null) context.Items[ReadDeniedKey] = true;
            throw;
        }
    }

    private static void AssertOpenCore(Node node)
    {
        if (node.Id == 0) return;
        AssertExtensionReady();
        Permission(node.Id, PermissionType.Open);
        if ((!node.Version.IsMajor || node.Version.Status != VersionStatus.Approved) &&
            !Has(node.Id, PermissionType.OpenMinor))
            throw new SenseNetSecurityException("M0 image asset version access is not permitted.");
        var own = Snapshot.Read(node.Id);
        // Previous generations are separate sets. Old mutable versions of one
        // set/file cannot expose a former source binding or former byte stream.
        if (node.VersionId != own.Head.LastMinorVersionId || node.NodeTimestamp != own.Head.Timestamp)
            throw new SenseNetSecurityException("M0 image asset version is not current.");
        var set = own.Type == "ImageVariantSet" ? own : ReadContainingSet(own);
        var owner = ValidateSet(set);
        if (!Has(owner.Head.Id, PermissionType.Save))
        {
            if (!set.Boolean("Sealed") ||
                !owner.Ids("CoverImageSet").SequenceEqual(new[] { set.Head.Id }))
                throw new SenseNetSecurityException("M0 image generation is not active.");
            // An older file version is never an alternative image byte source.
            if (own.Type == "ImageVariant" && node.VersionId != own.Head.LastMinorVersionId)
                throw new SenseNetSecurityException("M0 image variant version is not current.");
            if (own.Type == "ImageVariantSet" && node.VersionId != own.Head.LastMinorVersionId)
                throw new SenseNetSecurityException("M0 image set version is not current.");
        }
        if (own.Type == "ImageVariant" && set.Boolean("Sealed"))
        {
            using var manifest = ParseManifest(set.String("Manifest"));
            ValidateManifestBinding(set, owner, manifest.RootElement);
            if (!manifest.RootElement.GetProperty("variants").EnumerateArray().Any(v =>
                    v.GetProperty("id").GetInt32() == own.Head.Id &&
                    v.GetProperty("name").GetString() == own.Head.Name))
                throw new SenseNetSecurityException("M0 image variant is not in the sealed manifest.");
        }
    }

    private static HttpContext? CurrentHttpContext()
    {
        var accessor = Providers.Instance.Services.GetService(typeof(IHttpContextAccessor)) as IHttpContextAccessor;
        return accessor?.HttpContext ?? new HttpContextAccessor().HttpContext;
    }

    private static void EnforceNoStore()
    {
        // Extensionless variant names bypass stock pre-load 304 processing.
        // This final callback also defeats a caller-supplied ?maxAge=N.
        var context = CurrentHttpContext();
        if (context is null || context.Items.ContainsKey(NoStoreKey)) return;
        context.Items[NoStoreKey] = true;
        context.Response.OnStarting(() =>
        {
            context.Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
            context.Response.Headers["Pragma"] = "no-cache";
            context.Response.Headers.Remove("ETag");
            // Stock non-OData binary middleware otherwise exposes this caught
            // security rejection as a developer HTTP 500. Preserve the throw;
            // only this request's explicit security-denial marker maps to 403.
            if (context.Items.ContainsKey(ReadDeniedKey))
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        });
    }

    internal static Snapshot ReadContainingSet(Snapshot file)
    {
        if (file.Type != "ImageVariant") throw Invalid();
        Permission(file.Head.ParentId, PermissionType.Open);
        var set = Snapshot.Read(file.Head.ParentId);
        if (set.Type != "ImageVariantSet" ||
            file.Head.Path != set.Head.Path + "/" + file.Head.Name ||
            file.Head.Name.Contains('/') || file.Head.Name.Contains('\\')) throw Invalid();
        return set;
    }

    internal static Snapshot ValidateSet(Snapshot set)
    {
        if (set.Type != "ImageVariantSet") throw Invalid();
        var owners = set.Ids("OwnerContent");
        if (owners.Length != 1) throw Invalid();
        var owner = ReadOwner(owners[0]);
        var generation = set.String("GenerationId");
        if (!Guid.TryParseExact(generation, "D", out _) ||
            set.Head.Name != generation ||
            set.Head.Path != AssetsPath + "/" + owners[0] + "/" + generation)
            throw Invalid();
        var sourceIds = set.Ids("SourceContents");
        if (sourceIds.Length is < 1 or > 4 || sourceIds.Distinct().Count() != sourceIds.Length)
            throw Invalid();
        foreach (var id in sourceIds)
        {
            var source = ReadOwner(id);
            if (source.Type is not ("MediaItem" or "BookMediaItem")) throw Invalid();
        }
        if (owner.Type != "Timeline" && !sourceIds.SequenceEqual(new[] { owner.Head.Id }))
            throw Invalid();
        return owner;
    }

    internal static Snapshot ReadOwner(int id)
    {
        Permission(id, PermissionType.Open);
        var owner = Snapshot.Read(id);
        owner.AssertVersionOpen();
        var container = owner.Type == "Timeline" ? ProjectPath + "/Timelines/" :
            owner.Type is "MediaItem" or "BookMediaItem" ? ProjectPath + "/MediaLibrary/" : null;
        if (container is null || !owner.Head.Path.StartsWith(container, StringComparison.Ordinal) ||
            (owner.Type == "Timeline" && owner.Head.Path.Substring(container.Length).Contains('/'))) throw Invalid();
        return owner;
    }

    internal static void AssertSetWrite(ImageVariantSetSecurityHandler set)
    {
        AssertExtensionReady();
        if (set.NodeType.Name != "ImageVariantSet" ||
            (set.Id > 0 && set.IsPropertyChanged("AllowedChildTypes")) ||
            set.AllowedChildTypes.Any(type => type.Name != "ImageVariant")) throw Invalid();
        Permission(set.Id == 0 ? set.ParentId : set.Id,
            set.Id == 0 ? PermissionType.AddNew : PermissionType.Save);
        // Current persisted seal wins over the incoming version or field value.
        if (set.Id > 0 && Snapshot.ReadAuthorized(set.Id).Boolean("Sealed"))
            throw new SenseNetSecurityException("M0 sealed image generations are immutable.");
        var ownerIds = set.RawIds("OwnerContent");
        if (ownerIds.Length != 1) throw Invalid();
        var owner = ReadOwner(ownerIds[0]);
        Permission(owner.Head.Id, PermissionType.Save);
        var generation = set.RawString("GenerationId");
        if (!Guid.TryParseExact(generation, "D", out _)) throw Invalid();
        Permission(set.ParentId, PermissionType.Open);
        var parent = Snapshot.Read(set.ParentId);
        if (parent.Type != "Folder" || parent.Head.Path != AssetsPath + "/" + owner.Head.Id) throw Invalid();
        if (set.Name != generation) throw Invalid();
        var sources = set.RawIds("SourceContents");
        if (sources.Length is < 1 or > 4 || sources.Distinct().Count() != sources.Length) throw Invalid();
        foreach (var sourceId in sources)
        {
            var source = ReadOwner(sourceId);
            if (source.Type is not ("MediaItem" or "BookMediaItem")) throw Invalid();
        }
        if (owner.Type != "Timeline" && !sources.SequenceEqual(new[] { owner.Head.Id })) throw Invalid();
        if (set.Id > 0)
        {
            var persisted = Snapshot.ReadAuthorized(set.Id);
            if (!persisted.Ids("OwnerContent").SequenceEqual(ownerIds) ||
                !persisted.Ids("SourceContents").OrderBy(id => id).SequenceEqual(sources.OrderBy(id => id)) ||
                persisted.String("GenerationId") != generation || persisted.Head.ParentId != set.ParentId ||
                persisted.Head.Path != parent.Head.Path + "/" + generation || persisted.Head.Name != generation) throw Invalid();
        }
        using var manifest = ParseManifest(set.RawString("Manifest"));
        ValidateManifestBinding(owner.Head.Id, owner.Type, generation, sources, manifest.RootElement);
        if (set.RawBoolean("Sealed"))
        {
            if (set.Id == 0 || set.SavingState != ContentSavingState.Finalized) throw Invalid();
            ValidateOutputs(set, manifest.RootElement);
        }
    }

    internal static void AssertFileWrite(ImageVariantSecurityHandler file)
    {
        AssertExtensionReady();
        if (file.NodeType.Name != "ImageVariant" ||
            (file.Id > 0 && file.IsPropertyChanged("AllowedChildTypes")) ||
            file.AllowedChildTypes.Any()) throw Invalid();
        Permission(file.Id == 0 ? file.ParentId : file.Id,
            file.Id == 0 ? PermissionType.AddNew : PermissionType.Save);
        Permission(file.ParentId, PermissionType.Open);
        var set = Snapshot.Read(file.ParentId);
        var owner = ValidateSet(set);
        Permission(owner.Head.Id, PermissionType.Save);
        if (file.Id == 0 && Providers.Instance.DataProvider.GetChildrenIdentifiersAsync(file.ParentId, CancellationToken.None)
                .ConfigureAwait(false).GetAwaiter().GetResult().Count() >= 3) throw Invalid();
        if (set.Boolean("Sealed"))
            throw new SenseNetSecurityException("M0 sealed image generations are immutable.");
        if (!SafePngName(file.Name)) throw Invalid();
        if (file.Id > 0)
        {
            var persisted = Snapshot.ReadAuthorized(file.Id);
            if (persisted.Head.ParentId != file.ParentId || persisted.Head.Name != file.Name) throw Invalid();
        }
        if (file.SavingState == ContentSavingState.Finalized)
        {
            // Native upload derives generic MIME from the extensionless name.
            // The complete narrow PNG decoder must succeed before persistence.
            var binary = file.RawBinary;
            if (binary.ContentType is "" or "application/octet-stream")
                binary.ContentType = "image/png";
            PngVariantValidator.Validate(file.RawBinary, null);
        }
    }

    // No extension is a security prerequisite: stock BinaryHandler otherwise
    // can produce 304 before any content-handler policy executes.
    private static bool SafePngName(string name) => name.Length is >= 2 and <= 5 &&
        name[0] == 'w' && name[1] is >= '1' and <= '9' &&
        name.Substring(1).All(c => c is >= '0' and <= '9');

    internal static void AssertCoverReference(Node owner)
    {
        if (!owner.IsPropertyChanged("CoverImageSet")) return;
        if (owner.Id > 0) Permission(owner.Id, PermissionType.Save);
        var ids = RawIds(owner, "CoverImageSet");
        if (ids.Length == 0) return;
        AssertExtensionReady();
        if (owner.Id <= 0 || ids.Length != 1) throw Invalid();
        Permission(owner.Id, PermissionType.Save);
        Permission(ids[0], PermissionType.Open);
        var set = Snapshot.Read(ids[0]);
        var boundOwner = ValidateSet(set);
        if (boundOwner.Head.Id != owner.Id || !set.Boolean("Sealed")) throw Invalid();
        using var manifest = ParseManifest(set.String("Manifest"));
        ValidateManifestBinding(set, boundOwner, manifest.RootElement);
    }

    internal static void AssertOwnerDelete(Node owner)
    {
        Permission(owner.Id, PermissionType.Open);
        var current = Snapshot.Read(owner.Id);
        if (current.Ids("CoverImageSet").Length != 0)
            throw new SenseNetSecurityException("M0 owner cover reference must be cleared before deletion.");
    }

    internal static int[] RawIds(Node node, string name)
    {
        if (name == "CoverImageSet" && !node.NodeType.PropertyTypes.Any(p => p.Name == name))
            return Array.Empty<int>(); // Existing content before optional schema install.
        return node.GetReferences(name) is NodeList<Node> references
            ? references.GetIdentifiers().ToArray() : Array.Empty<int>();
    }

    internal static void AssertSetDelete(ImageVariantSetSecurityHandler node)
    {
        Permission(node.Id, PermissionType.Open);
        Permission(node.Id, PermissionType.Delete);
        var set = Snapshot.Read(node.Id);
        var owner = ValidateSet(set);
        Permission(owner.Head.Id, PermissionType.Save);
        if (owner.Ids("CoverImageSet").Contains(set.Head.Id))
            throw new SenseNetSecurityException("M0 active image generations cannot be deleted.");
        var children = Providers.Instance.DataProvider.GetChildrenIdentifiersAsync(node.Id, CancellationToken.None)
            .ConfigureAwait(false).GetAwaiter().GetResult().ToArray();
        if (children.Length > 3) throw Invalid();
        foreach (var id in children)
        {
            Permission(id, PermissionType.Open); Permission(id, PermissionType.Delete);
            var child = Snapshot.Read(id);
            if (child.Type != "ImageVariant" || child.Head.ParentId != node.Id ||
                child.Head.Path != set.Head.Path + "/" + child.Head.Name) throw Invalid();
        }
    }

    private static void ValidateOutputs(ImageVariantSetSecurityHandler set, JsonElement manifest)
    {
        var variants = manifest.GetProperty("variants").EnumerateArray().ToArray();
        if (variants.Length is < 1 or > 3) throw Invalid();
        var ids = new HashSet<int>();
        var names = new HashSet<string>(StringComparer.Ordinal);
        long total = 0;
        foreach (var variant in variants)
        {
            var id = variant.GetProperty("id").GetInt32();
            var name = variant.GetProperty("name").GetString() ?? "";
            if (!ids.Add(id) || !names.Add(name) || !SafePngName(name)) throw Invalid();
            Permission(id, PermissionType.Open);
            var snapshot = Snapshot.Read(id);
            if (snapshot.Type != "ImageVariant" || snapshot.Head.ParentId != set.Id ||
                snapshot.Head.Path != set.RawPath + "/" + name || snapshot.Head.Name != name) throw Invalid();
            var file = Node.LoadNode(id, VersionNumber.LastAccessible) as ImageVariantSecurityHandler;
            if (file is null || file.VersionId != snapshot.Head.LastMinorVersionId ||
                file.SavingState != ContentSavingState.Finalized) throw Invalid();
            total += PngVariantValidator.Validate(file.RawBinary, variant);
        }
        // Count actual repository children, not a caller-supplied manifest count.
        var childIds = Providers.Instance.DataProvider.GetChildrenIdentifiersAsync(set.Id, CancellationToken.None)
            .ConfigureAwait(false).GetAwaiter().GetResult();
        if (!ids.SetEquals(childIds) || total > 3 * 1024 * 1024) throw Invalid();
    }

    private static JsonDocument ParseManifest(string value)
    {
        if (Encoding.UTF8.GetByteCount(value) is < 2 or > 16384) throw Invalid();
        try
        {
            var document = JsonDocument.Parse(value, new JsonDocumentOptions { MaxDepth = 16 });
            RejectDuplicateProperties(document.RootElement);
            return document;
        }
        catch (JsonException) { throw Invalid(); }
    }

    private static void RejectDuplicateProperties(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!names.Add(property.Name)) throw Invalid();
                RejectDuplicateProperties(property.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var item in element.EnumerateArray()) RejectDuplicateProperties(item);
    }

    private static void ValidateManifestBinding(Snapshot set, Snapshot owner, JsonElement manifest) =>
        ValidateManifestBinding(owner.Head.Id, owner.Type, set.String("GenerationId"),
            set.Ids("SourceContents"), manifest);

    private static void ValidateManifestBinding(int ownerId, string ownerType, string generation,
        int[] sources, JsonElement manifest)
    {
        if (manifest.ValueKind != JsonValueKind.Object || manifest.GetProperty("schemaVersion").GetInt32() != 1 ||
            manifest.GetProperty("projectPath").GetString() != ProjectPath ||
            manifest.GetProperty("ownerId").GetInt32() != ownerId ||
            manifest.GetProperty("generationId").GetString() != generation ||
            manifest.GetProperty("kind").GetString() != (ownerType == "Timeline" ? "timeline-composite" : "media-sizes") ||
            !manifest.GetProperty("sourceIds").EnumerateArray().Select(v => v.GetInt32()).OrderBy(v => v)
                .SequenceEqual(sources.OrderBy(v => v)) ||
            manifest.GetProperty("variants").ValueKind != JsonValueKind.Array ||
            manifest.GetProperty("variants").GetArrayLength() > 3) throw Invalid();
    }

    internal static InvalidOperationException Invalid([CallerMemberName] string member = "",
        [CallerLineNumber] int line = 0) =>
        new($"M0 image asset binding or manifest is invalid ({member}:{line}).");

    internal sealed class Snapshot
    {
        internal NodeHead Head { get; }
        private readonly IDictionary<int, object> _data;
        private readonly SenseNet.ContentRepository.Storage.Schema.NodeType _type;
        internal string Type => _type.Name;
        private Snapshot(NodeHead head, IDictionary<int, object> data)
        {
            Head = head; _data = data;
            _type = Providers.Instance.StorageSchema.NodeTypes.GetItemById(head.NodeTypeId);
        }
        internal static Snapshot ReadAuthorized(int id) { Permission(id, PermissionType.Open); return Read(id); }
        internal static Snapshot Read(int id)
        {
            var provider = Providers.Instance.DataProvider;
            var head = provider.LoadNodeHeadAsync(id, CancellationToken.None).ConfigureAwait(false).GetAwaiter().GetResult();
            if (head is null || head.LastMinorVersionId <= 0) throw Invalid();
            var data = provider.LoadNodesAsync(new[] { head.LastMinorVersionId }, CancellationToken.None)
                .ConfigureAwait(false).GetAwaiter().GetResult().SingleOrDefault()?.GetDynamicDataIdKey();
            if (data is null) throw Invalid();
            return new Snapshot(head, data);
        }
        internal void AssertVersionOpen()
        {
            var version = Providers.Instance.DataProvider.GetVersionNumbersAsync(Head.Id, CancellationToken.None)
                .ConfigureAwait(false).GetAwaiter().GetResult()
                .SingleOrDefault(v => v.VersionId == Head.LastMinorVersionId)?.VersionNumber;
            if (version is null || ((!version.IsMajor || version.Status != VersionStatus.Approved) &&
                !Has(Head.Id, PermissionType.OpenMinor)))
                throw new SenseNetSecurityException("M0 image source version access is not permitted.");
        }
        private object? Value(string name, StorageDataType type)
        {
            var property = _type.PropertyTypes.FirstOrDefault(p => p.Name == name);
            if (property is null || property.DataType != type) throw Invalid();
            if (type == StorageDataType.Text)
                return Providers.Instance.DataProvider.LoadTextPropertyValuesAsync(Head.LastMinorVersionId,
                    new[] { property.Id }, CancellationToken.None).ConfigureAwait(false).GetAwaiter().GetResult()
                    .GetValueOrDefault(property.Id) ?? "";
            return _data.TryGetValue(property.Id, out var value) ? value : property.DefaultValue;
        }
        internal int[] Ids(string name)
        {
            if (name == "CoverImageSet" && !_type.PropertyTypes.Any(p => p.Name == name))
                return Array.Empty<int>();
            return Value(name, StorageDataType.Reference) is IEnumerable<int> ids ? ids.ToArray() : Array.Empty<int>();
        }
        internal string String(string name) => Value(name, name == "Manifest" ? StorageDataType.Text : StorageDataType.String) as string ?? "";
        internal bool Boolean(string name) => Value(name, StorageDataType.Int) is int value && value != 0;
    }
}
