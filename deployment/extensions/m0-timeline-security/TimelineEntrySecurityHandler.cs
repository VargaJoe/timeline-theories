using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using SenseNet.Configuration;
using SenseNet.ContentRepository;
using SenseNet.ContentRepository.Schema;
using SenseNet.ContentRepository.Storage;
using SenseNet.ContentRepository.Storage.Events;
using SenseNet.ContentRepository.Storage.Security;
using SenseNet.Search.Indexing;
using SenseNet.Search.Querying;
using AsyncTask = System.Threading.Tasks.Task;
using PermissionType = SenseNet.ContentRepository.Storage.Security.PermissionType;

namespace Timeline.Theories.M0.Security;

/// <summary>
/// Keeps the existing Reference field/storage binding while enforcing target
/// reads and explicit relation writes on TimelineEntry.MediaItem. The pinned
/// repository does not permit changing an existing field's handler class.
/// </summary>
[ContentHandler]
public class TimelineEntrySecurityHandler : GenericContent
{
    private const string MediaField = "MediaItem";
    private readonly DeletionPathScope _deletionPath = new();

    public TimelineEntrySecurityHandler(Node parent) : this(parent, "TimelineEntry") { }
    public TimelineEntrySecurityHandler(Node parent, string nodeTypeName)
        : base(parent, nodeTypeName) { }
    protected TimelineEntrySecurityHandler(NodeToken token) : base(token) { }

    public override string Path
    {
        get => _deletionPath.ReadPath(this, base.Path);
    }

    public override async AsyncTask DeleteAsync(bool bypassTrash, CancellationToken cancellationToken)
    {
        using var scope = _deletionPath.Begin(this, () => base.Path);
        await base.DeleteAsync(bypassTrash, cancellationToken).ConfigureAwait(false);
    }

    public override async AsyncTask ForceDeleteAsync(CancellationToken cancellationToken)
    {
        using var scope = _deletionPath.Begin(this, () => base.Path);
        await base.ForceDeleteAsync(cancellationToken).ConfigureAwait(false);
    }

    protected override void OnLoaded(object sender, NodeEventArgs e)
    {
        DomainReadPolicy.AssertOpen(this);
        base.OnLoaded(sender, e);
    }

    public override object GetProperty(string name)
    {
        DomainReadPolicy.AssertOpen(this);
        if (!string.Equals(name, MediaField, StringComparison.Ordinal))
            return base.GetProperty(name);

        AssertEntryScope();
        var readable = new List<Node>();
        var caller = AccessProvider.Current.GetOriginalUser();
        var security = Providers.Instance.SecurityHandler;
        foreach (var id in GetMediaIdentifiers())
        {
            if (!security.HasPermission(caller, id, PermissionType.Open))
                continue;

            // Explicit major selection prevents an inherited system context
            // from exposing a minor version to a caller lacking OpenMinor.
            var version = security.HasPermission(caller, id, PermissionType.OpenMinor)
                ? VersionNumber.LastAccessible
                : VersionNumber.LastMajor;
            var node = Node.LoadNode(id, version);
            if (node is not null && !node.IsHeadOnly && !node.IsPreviewOnly)
                readable.Add(node);
        }

        // ReferenceField.ConvertTo accepts IEnumerable<Node>. Returning a new
        // list filters only projection; no raw relation or field is changed.
        return readable;
    }

    public override void SetProperty(string name, object value)
    {
        if (!string.Equals(name, MediaField, StringComparison.Ordinal))
        {
            base.SetProperty(name, value);
            return;
        }

        AssertEntryScope();
        var caller = AccessProvider.Current.GetOriginalUser();
        var security = Providers.Instance.SecurityHandler;
        var ownerId = Id == 0 ? Parent.Id : Id;
        var permission = Id == 0 ? PermissionType.AddNew : PermissionType.Save;
        if (!security.HasPermission(caller, ownerId, permission))
            throw new SenseNetSecurityException("M0 MediaItem reference write is not permitted.");

        var targetIds = new List<int>();
        if (value is Node node)
            targetIds.Add(node.Id);
        else if (value is NodeList<Node> references)
            targetIds.AddRange(references.GetIdentifiers());
        else if (value is IEnumerable values)
            foreach (var item in values)
            {
                if (item is not Node reference)
                    throw new InvalidOperationException("M0 MediaItem reference write data is invalid.");
                targetIds.Add(reference.Id);
            }
        else if (value is not null)
            throw new InvalidOperationException("M0 MediaItem reference write data is invalid.");

        // Stock import can normalize an unreadable incoming reference to an
        // empty value before this setter. Reject that explicit change instead
        // of clearing the existing relation. Omitted fields never call here.
        if (targetIds.Count == 0)
            throw new SenseNetSecurityException("M0 MediaItem reference requires a readable target.");
        foreach (var id in targetIds)
            AssertReadableWriteTarget(id);

        // Called by Field.WriteProperties only for an incoming field change;
        // unrelated scalar updates preserve the underlying relation IDs.
        base.SetProperty(name, value);
    }

    public override IEnumerable<IIndexableField> GetIndexableFields()
    {
        AssertEntryScope();
        foreach (var field in base.GetIndexableFields())
            yield return string.Equals(field.Name, MediaField, StringComparison.Ordinal)
                ? new MediaReferenceIndexField(this, field as Field
                    ?? throw new InvalidOperationException("M0 MediaItem indexing field is invalid."))
                : field;
    }

    private int[] GetMediaIdentifiers()
    {
        // Node.GetReferences bypasses GenericContent.GetProperty and returns
        // storage NodeList. GetIdentifiers reads only IDs, never target data.
        var references = GetReferences(MediaField);
        return references is null
            ? Array.Empty<int>()
            : references is NodeList<Node> nodes
                ? nodes.GetIdentifiers().ToArray()
                : throw new InvalidOperationException("M0 MediaItem reference storage is invalid.");
    }

    private static void AssertReadableWriteTarget(int id)
    {
        if (id <= 0 || !Providers.Instance.SecurityHandler.HasPermission(
                AccessProvider.Current.GetOriginalUser(), id, PermissionType.Open))
            throw new SenseNetSecurityException("M0 MediaItem reference target is not readable.");
    }

    private void AssertEntryScope()
    {
        if (!string.Equals(NodeType.Name, "TimelineEntry", StringComparison.Ordinal))
            throw new InvalidOperationException("M0 TimelineEntry security handler scope is invalid.");
    }

    private sealed class MediaReferenceIndexField : IIndexableField
    {
        private readonly TimelineEntrySecurityHandler _entry;
        private readonly Field _field;

        public MediaReferenceIndexField(TimelineEntrySecurityHandler entry, Field field)
        {
            _entry = entry;
            _field = field;
        }

        public string Name => _field.Name;
        public bool IsInIndex => _field.IsInIndex;
        public bool IsBinaryField => _field.IsBinaryField;
        public bool LocalizationEnabled => _field.LocalizationEnabled;
        public bool IsLocalized => _field.IsLocalized;
        public object GetData() => _field.GetData();
        public string GetStoredValue() => _field.GetStoredValue();

        public IEnumerable<IndexField> GetIndexFields(out string textExtract)
        {
            textExtract = string.Empty;
            var indexing = _field.FieldSetting.IndexingInfo
                ?? throw new InvalidOperationException("M0 MediaItem reference indexing is invalid.");
            var ids = _entry.GetMediaIdentifiers();

            // Stock ReferenceIndexHandler uses GetData; use raw IDs instead
            // so caller redaction cannot replace the stored index with null.
            return new[]
            {
                ids.Length == 0
                    ? new IndexField(Name, SnQuery.NullReferenceValue, indexing.IndexingMode,
                        indexing.IndexStoringMode, indexing.TermVectorStoringMode)
                    : new IndexField(Name, ids, indexing.IndexingMode,
                        indexing.IndexStoringMode, indexing.TermVectorStoringMode)
            };
        }
    }
}
