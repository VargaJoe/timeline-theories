using System.Threading;
using SenseNet.ContentRepository;
using SenseNet.ContentRepository.Schema;
using SenseNet.ContentRepository.Storage;
using SenseNet.ContentRepository.Storage.Events;
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
        // OnLoaded is bypassed on L2 cache hits. Fresh OData field wrappers
        // call this getter, including an Id-only selection/preflight.
        DomainReadPolicy.AssertOpen(this);
        return base.GetProperty(name);
    }
}
