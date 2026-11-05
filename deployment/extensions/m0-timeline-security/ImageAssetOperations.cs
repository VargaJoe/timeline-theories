using System;
using System.Globalization;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using SenseNet.ApplicationModel;
using SenseNet.Configuration;
using SenseNet.ContentRepository;
using SenseNet.ContentRepository.Schema;
using SenseNet.ContentRepository.Storage;
using SenseNet.ContentRepository.Storage.Security;
using SenseNet.Security;
using PermissionType = SenseNet.ContentRepository.Storage.Security.PermissionType;

namespace Timeline.Theories.M0.Security;

/// <summary>Caller-authorized native operations; no inventory/admin credential.</summary>
public static class ImageAssetOperations
{
    private static readonly AsyncLocal<int> CreatingOwnerFolder = new();
    private static readonly AsyncLocal<int> DeletingSet = new();
    internal static bool IsPreparingFolder(int ownerId) => ownerId > 0 && CreatingOwnerFolder.Value == ownerId;
    internal static bool IsDeletingSet(int setId) => setId > 0 && DeletingSet.Value == setId;

    [ODataFunction(Category = "Timeline images")]
    [AllowedRoles("All")]
    public static object ImageAssetCapabilities(Content content, HttpContext context)
    {
        AssertProject(content);
        ImageAssetPolicy.AssertExtensionReady();
        RasterVariantValidator.AssertAvailable();
        foreach (var typeName in new[] { "Timeline", "MediaItem", "BookMediaItem" })
            if (!Providers.Instance.StorageSchema.NodeTypes[typeName].PropertyTypes.Any(p => p.Name == "CoverImageSet"))
                throw ImageAssetPolicy.Invalid();
        if (Providers.Instance.StorageSchema.NodeTypes["ImageVariantSet"].Name != "ImageVariantSet" ||
            Providers.Instance.StorageSchema.NodeTypes["ImageVariant"].Name != "ImageVariant") throw ImageAssetPolicy.Invalid();
        if (ContentType.GetByName("ImageVariantSet").HandlerName != typeof(ImageVariantSetSecurityHandler).FullName ||
            ContentType.GetByName("ImageVariant").HandlerName != typeof(ImageVariantSecurityHandler).FullName)
            throw ImageAssetPolicy.Invalid();
        NoStore(context);
        return new { protocol = "timeline-image-assets-v1", supported = true,
            decoder = IsolatedImageDecoder.Diagnostics(),
            formats = new[] { "image/webp", "image/jpeg", "image/png" }, maxVariantBytes = 1048576,
            maxSetBytes = 3145728, maxVariants = 3, maxPixels = 4194304, maxDimension = 4096,
            templates = new[] { "poster-strip-v1", "media-sizes-v1" } };
    }

    [ODataFunction(Category = "Timeline images")]
    [AllowedRoles("All")]
    public static object GetImagePresentation(Content content, HttpContext context)
    {
        ImageAssetPolicy.AssertExtensionReady();
        NoStore(context);
        var owner = ImageAssetPolicy.ReadOwner(content.Id);
        var stamp = owner.Type == "Timeline" ? null : ImageAssetPolicy.ImageStamp(owner);
        var ownerGuard = new { versionId = owner.Head.LastMinorVersionId, version = CurrentVersion(owner), modificationDate = DateTime.SpecifyKind(
            owner.Head.ModificationDate, DateTimeKind.Utc).ToString("O", CultureInfo.InvariantCulture),
            token = owner.Head.Timestamp.ToString(CultureInfo.InvariantCulture) };
        var ids = owner.Ids("CoverImageSet");
        if (ids.Length == 0) return new { state = "legacy", imageStamp = stamp, ownerGuard };
        if (ids.Length != 1) throw ImageAssetPolicy.Invalid();
        try
        {
        ImageAssetPolicy.Permission(ids[0], PermissionType.Open);
        var set = ImageAssetPolicy.Snapshot.Read(ids[0]);
        if (ImageAssetPolicy.ValidateSet(set).Head.Id != owner.Head.Id || !set.Boolean("Sealed")) throw ImageAssetPolicy.Invalid();
        using var document = ImageAssetPolicy.ParseManifest(set.String("Manifest"));
        ImageAssetPolicy.ValidateManifestBinding(owner.Head.Id, owner.Type, set.String("GenerationId"), set.Ids("SourceContents"), document.RootElement);
        if (!ImageAssetPolicy.SourcesCurrent(document.RootElement))
        {
            if (Providers.Instance.SecurityHandler.HasPermission(AccessProvider.Current.GetOriginalUser(), owner.Head.Id, PermissionType.Save))
                return new { state = "stale", setId = set.Head.Id, generationId = set.String("GenerationId"),
                    imageStamp = stamp, ownerGuard, manifest = set.String("Manifest") };
            return new { state = "stale", setId = set.Head.Id, generationId = set.String("GenerationId"), imageStamp = stamp, ownerGuard };
        }
        // Return only the exact validated presentation, never arbitrary set data.
        return new { state = "active", setId = set.Head.Id, generationId = set.String("GenerationId"),
            imageStamp = stamp, manifest = set.String("Manifest"), ownerGuard };
        }
        catch (SenseNetSecurityException)
        {
            // Owner authorization already succeeded. Preserve its raw pointer
            // for a deliberate reset without disclosing set/source metadata.
            return new { state = "blocked", setId = ids[0], imageStamp = stamp, ownerGuard };
        }
    }

    [ODataFunction(Category = "Timeline images")]
    [AllowedRoles("All")]
    public static object GetImageAssetSets(Content content, HttpContext context)
    {
        ImageAssetPolicy.AssertExtensionReady();
        NoStore(context);
        var owner = ImageAssetPolicy.ReadOwner(content.Id);
        ImageAssetPolicy.Permission(owner.Head.Id, PermissionType.Save);
        var type = Providers.Instance.StorageSchema.NodeTypes["ImageVariantSet"];
        var ids = Providers.Instance.DataProvider.QueryNodesByReferenceAndTypeAsync("OwnerContent", owner.Head.Id,
            new[] { type.Id }, context.RequestAborted).ConfigureAwait(false).GetAwaiter().GetResult()
            .Distinct().OrderBy(id => id).Take(51).ToArray();
        var results = new List<object>();
        foreach (var id in ids.Take(50))
        {
            try
            {
                ImageAssetPolicy.Permission(id, PermissionType.Open);
                var set = ImageAssetPolicy.Snapshot.Read(id);
                if (ImageAssetPolicy.ValidateSet(set).Head.Id != owner.Head.Id) throw ImageAssetPolicy.Invalid();
                using var manifest = ImageAssetPolicy.ParseManifest(set.String("Manifest"));
                ImageAssetPolicy.ValidateManifestBinding(owner.Head.Id, owner.Type, set.String("GenerationId"), set.Ids("SourceContents"), manifest.RootElement);
                var active = owner.Ids("CoverImageSet").Contains(id);
                var stale = !ImageAssetPolicy.SourcesCurrent(manifest.RootElement);
                var state = stale ? "stale" : !set.Boolean("Sealed") ? "draft" : active ? "active" : "inactive";
                var canDelete = false;
                if (!active)
                    try { ImageAssetPolicy.AssertSetDeletionSnapshot(set, owner.Head.Id); canDelete = true; }
                    catch (SenseNetSecurityException) { }
                results.Add(new { setId = id, path = set.Head.Path, generationId = set.String("GenerationId"),
                    @sealed = set.Boolean("Sealed"), active, state, canDelete });
            }
            catch (SenseNetSecurityException)
            {
                var canDelete = false;
                try { ImageAssetPolicy.AssertSetDeletionSnapshot(ImageAssetPolicy.Snapshot.Read(id), owner.Head.Id); canDelete = true; }
                catch (SenseNetSecurityException) { }
                results.Add(new { setId = id, state = "blocked", canDelete });
            }
        }
        return new { sets = results.ToArray(), hasMore = ids.Length > 50 };
    }

    [ODataAction(Category = "Timeline images")]
    [AllowedRoles("All")]
    public static async Task<object> DeleteImageAsset(Content content, HttpContext context, int setId)
    {
        NoStore(context);
        await ImageAssetPolicy.MutateAsync(async () =>
        {
            ImageAssetPolicy.AssertExtensionReady();
            var owner = ImageAssetPolicy.ReadOwner(content.Id);
            ImageAssetPolicy.Permission(owner.Head.Id, PermissionType.Save);
            ImageAssetPolicy.AssertSetDeletionSnapshot(ImageAssetPolicy.Snapshot.ReadAuthorized(setId), owner.Head.Id);
            DeletingSet.Value = setId;
            try
            {
                if (Node.LoadNode(setId) is not ImageVariantSetSecurityHandler set) throw ImageAssetPolicy.Invalid();
                await set.ForceDeleteAsync(context.RequestAborted).ConfigureAwait(false);
            }
            finally { DeletingSet.Value = 0; }
        }, context.RequestAborted).ConfigureAwait(false);
        return new { deleted = true, setId };
    }

    [ODataFunction(Category = "Timeline images")]
    [AllowedRoles("All")]
    public static async Task<object> GetImageAssetSetStatus(Content content, HttpContext context, int setId)
    {
        NoStore(context);
        object? result = null;
        await ImageAssetPolicy.MutateAsync(() =>
        {
            ImageAssetPolicy.AssertExtensionReady();
            var owner = ImageAssetPolicy.ReadOwner(content.Id);
            ImageAssetPolicy.Permission(owner.Head.Id, PermissionType.Save);
            if (setId <= 0) throw ImageAssetPolicy.Invalid();
            var head = Providers.Instance.DataProvider.LoadNodeHeadAsync(setId, context.RequestAborted)
                .ConfigureAwait(false).GetAwaiter().GetResult();
            if (head is null) result = new { exists = false, setId };
            else
            {
                var set = ImageAssetPolicy.Snapshot.Read(setId);
                if (set.Type != "ImageVariantSet" || !set.Ids("OwnerContent").SequenceEqual(new[] { owner.Head.Id }))
                    throw new SenseNetSecurityException("M0 image generation does not belong to this owner.");
                ImageAssetPolicy.Permission(setId, PermissionType.Open);
                var active = owner.Ids("CoverImageSet").Contains(setId);
                var canDelete = false;
                try { ImageAssetPolicy.AssertSetDeletionSnapshot(set, owner.Head.Id); canDelete = true; }
                catch (SenseNetSecurityException) { }
                result = new { exists = true, setId, active, canDelete };
            }
            return System.Threading.Tasks.Task.CompletedTask;
        }, context.RequestAborted).ConfigureAwait(false);
        return result!;
    }

    [ODataAction(Category = "Timeline images")]
    [AllowedRoles("All")]
    public static async Task<object> PrepareImageAssetDraft(Content content, HttpContext context, int ownerId,
        string generationId, string expectedVersion, string expectedModificationDate, string expectedOwnerToken, string manifest)
    {
        AssertProject(content);
        NoStore(context);
        object? result = null;
        await ImageAssetPolicy.MutateAsync(async () =>
        {
            ImageAssetPolicy.AssertExtensionReady();
            var owner = GuardOwner(ownerId, expectedVersion, expectedModificationDate, expectedOwnerToken);
            using var document = ImageAssetPolicy.ParseManifest(manifest);
            var value = document.RootElement;
            var sources = value.GetProperty("sourceIds").EnumerateArray().Select(v => v.GetInt32()).ToArray();
            if (!Guid.TryParseExact(generationId, "D", out _) || sources.Length is < 1 or > 4 ||
                sources.Distinct().Count() != sources.Length) throw ImageAssetPolicy.Invalid();
            ImageAssetPolicy.ValidateManifestBinding(ownerId, owner.Type, generationId, sources, value);
            if (!value.TryGetProperty("recipe", out _) || !value.TryGetProperty("sourceStamps", out _) ||
                value.GetProperty("variants").GetArrayLength() != 0) throw ImageAssetPolicy.Invalid();
            foreach (var id in sources)
            {
                var source = ImageAssetPolicy.ReadOwner(id);
                if (source.Type is not ("MediaItem" or "BookMediaItem")) throw ImageAssetPolicy.Invalid();
            }
            ImageAssetPolicy.AssertCurrentSources(value);
            var folderPath = ImageAssetPolicy.AssetsPath + "/" + ownerId.ToString(CultureInfo.InvariantCulture);
            Folder? folder = Node.LoadNode(folderPath) as Folder;
            if (folder is null)
            {
                // Sole elevation: create one fixed numeric folder, then add only
                // read-denies for the existing fixed M0 public identities. No
                // caller-selected path, permission grant, source read or set Save.
                CreatingOwnerFolder.Value = ownerId;
                try
                {
                    using (new SystemAccount())
                    {
                        var root = Node.LoadNode(ImageAssetPolicy.AssetsPath) as Folder;
                        if (root is null || root.NodeType.Name != "Folder") throw ImageAssetPolicy.Invalid();
                        folder = new Folder(root) { Name = ownerId.ToString(CultureInfo.InvariantCulture) };
                        folder.AllowedChildTypes = new[] { ContentType.GetByName("ImageVariantSet") };
                        await folder.SaveAsync(context.RequestAborted).ConfigureAwait(false);
                        var acl = Providers.Instance.SecurityHandler.CreateAclEditor();
                        foreach (var path in new[] { TimelineSecurityHandler.VisitorPath, TimelineSecurityHandler.ReaderPath })
                        {
                            var subject = Node.LoadNode(path);
                            if (subject is null) throw ImageAssetPolicy.Invalid();
                            acl.Deny(folder.Id, subject.Id, true, PermissionType.See, PermissionType.Open);
                        }
                        await acl.ApplyAsync(context.RequestAborted).ConfigureAwait(false);
                    }
                }
                finally { CreatingOwnerFolder.Value = 0; }
            }
            if (folder.NodeType.Name != "Folder" || folder.Path != folderPath) throw ImageAssetPolicy.Invalid();
            var set = Content.CreateNew("ImageVariantSet", folder, generationId);
            set["OwnerContent"] = new[] { Node.LoadNode(ownerId) };
            set["SourceContents"] = sources.Select(Node.LoadNode).ToArray();
            set["GenerationId"] = generationId;
            set["Manifest"] = manifest;
            set["Sealed"] = false;
            await set.SaveAsync(context.RequestAborted).ConfigureAwait(false);
            result = new { setId = set.Id, path = set.Path, ownerId, generationId, @sealed = false, manifest };
        }, context.RequestAborted).ConfigureAwait(false);
        return result!;
    }

    [ODataAction(Category = "Timeline images")]
    [AllowedRoles("All")]
    public static async Task<object> ActivateImageAsset(Content content, HttpContext context, int? setId,
        string expectedVersion, string expectedModificationDate, string expectedOwnerToken)
    {
        NoStore(context);
        await ImageAssetPolicy.MutateAsync(async () =>
        {
            ImageAssetPolicy.AssertExtensionReady();
            var owner = GuardOwner(content.Id, expectedVersion, expectedModificationDate, expectedOwnerToken);
            if (content.ContentHandler.NodeTimestamp != owner.Head.Timestamp) throw ImageAssetPolicy.Invalid();
            content["CoverImageSet"] = setId.HasValue ? new[] { Node.LoadNode(setId.Value) } : Array.Empty<Node>();
            await content.SaveAsync(context.RequestAborted).ConfigureAwait(false);
        }, context.RequestAborted).ConfigureAwait(false);
        return new { setId };
    }

    private static string CurrentVersion(ImageAssetPolicy.Snapshot owner) => Providers.Instance.DataProvider
        .GetVersionNumbersAsync(owner.Head.Id, CancellationToken.None).ConfigureAwait(false).GetAwaiter().GetResult()
        .Single(v => v.VersionId == owner.Head.LastMinorVersionId).VersionNumber.ToString();

    private static ImageAssetPolicy.Snapshot GuardOwner(int id, string version, string modificationDate, string ownerToken)
    {
        var owner = ImageAssetPolicy.ReadOwner(id);
        ImageAssetPolicy.Permission(id, PermissionType.Save);
        var latest = CurrentVersion(owner);
        // JSON.NET in stock OData parses an ISO JSON string as JTokenType.Date,
        // then binds it to string via DateTime.ToString, losing fractions. An
        // explicit wire prefix preserves the exact caller-approved ISO value.
        if (modificationDate is null || !modificationDate.StartsWith("utc:", StringComparison.Ordinal) ||
            !DateTimeOffset.TryParse(modificationDate.Substring(4), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var expected) ||
            ownerToken != owner.Head.Timestamp.ToString(CultureInfo.InvariantCulture) ||
            latest != version || expected.ToUnixTimeMilliseconds() != new DateTimeOffset(
                DateTime.SpecifyKind(owner.Head.ModificationDate, DateTimeKind.Utc)).ToUnixTimeMilliseconds())
            throw new InvalidOperationException("M0 image owner revision conflict.");
        return owner;
    }

    private static void AssertProject(Content content)
    {
        if (content.Path != ImageAssetPolicy.ProjectPath) throw ImageAssetPolicy.Invalid();
        ImageAssetPolicy.Permission(content.Id, PermissionType.Open);
    }
    private static void NoStore(HttpContext context) => context.Response.Headers["Cache-Control"] = "no-store";
}
