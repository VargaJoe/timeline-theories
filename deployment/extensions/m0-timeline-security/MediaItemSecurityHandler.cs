using System.Collections.Generic;
using System.Threading;
using SenseNet.ContentRepository;
using SenseNet.ContentRepository.Schema;
using SenseNet.ContentRepository.Storage;
using SenseNet.ContentRepository.Storage.Events;
using SenseNet.Search.Indexing;
using AsyncTask = System.Threading.Tasks.Task;

namespace Timeline.Theories.M0.Security;

/// <summary>
/// Whole-target Open gate for the local MediaItem and BookMediaItem CTDs.
/// Stock fields, storage bindings, and write permissions are preserved.
/// </summary>
[ContentHandler]
public class MediaItemSecurityHandler : GenericContent
{
    private readonly DeletionPathScope _deletionPath = new();

    public MediaItemSecurityHandler(Node parent) : this(parent, "MediaItem") { }
    public MediaItemSecurityHandler(Node parent, string nodeTypeName)
        : base(parent, nodeTypeName) { }
    protected MediaItemSecurityHandler(NodeToken token) : base(token) { }

    public override string Path
    {
        get => _deletionPath.ReadPath(this, base.Path);
    }

    public override AsyncTask DeleteAsync(bool bypassTrash, CancellationToken cancellationToken) =>
        ImageAssetPolicy.MutateAsync(async () =>
        {
            ImageAssetPolicy.AssertOwnerDelete(this);
            using var scope = _deletionPath.Begin(this, () => base.Path);
            await base.DeleteAsync(bypassTrash, cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    public override AsyncTask ForceDeleteAsync(CancellationToken cancellationToken) =>
        ImageAssetPolicy.MutateAsync(async () =>
        {
            ImageAssetPolicy.AssertOwnerDelete(this);
            using var scope = _deletionPath.Begin(this, () => base.Path);
            await base.ForceDeleteAsync(cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    protected override void OnLoaded(object sender, NodeEventArgs e)
    {
        DomainReadPolicy.AssertOpen(this);
        base.OnLoaded(sender, e);
    }

    protected override void OnDeletingPhysically(object sender, CancellableNodeEventArgs e)
    {
        ImageAssetPolicy.AssertOwnerDelete(this);
        base.OnDeletingPhysically(sender, e);
    }

    public override object GetProperty(string name)
    {
        // OnLoaded is bypassed on L2 cache hits. Fresh OData field wrappers
        // call this getter, including an Id-only selection/preflight.
        DomainReadPolicy.AssertOpen(this);
        return base.GetProperty(name);
    }

    public override IEnumerable<IIndexableField> GetIndexableFields() =>
        CoverImageSetIndexField.PreserveReference(this, base.GetIndexableFields());

    public override AsyncTask SaveAsync(NodeSaveSettings settings,
        CancellationToken cancellationToken) => ImageAssetPolicy.MutateAsync(async () =>
        {
            ImageAssetPolicy.AssertCoverReference(this);
            await base.SaveAsync(settings, cancellationToken).ConfigureAwait(false);
        }, cancellationToken);
}
