using System;
using System.Threading;
using SenseNet.ContentRepository;
using SenseNet.ContentRepository.Schema;
using SenseNet.ContentRepository.Storage;
using SenseNet.ContentRepository.Storage.Events;
using AsyncTask = System.Threading.Tasks.Task;

namespace Timeline.Theories.M0.Security;

[ContentHandler]
public class ImageVariantSetSecurityHandler : Folder
{
    private readonly DeletionPathScope _deletionPath = new(ImageAssetPolicy.AssertOpen);
    public ImageVariantSetSecurityHandler(Node parent) : this(parent, "ImageVariantSet") { }
    public ImageVariantSetSecurityHandler(Node parent, string nodeTypeName) : base(parent, nodeTypeName) { }
    protected ImageVariantSetSecurityHandler(NodeToken token) : base(token) { }

    internal string RawPath => base.Path;
    internal string RawString(string name) => base.GetProperty(name) as string ?? "";
    internal bool RawBoolean(string name) => Convert.ToBoolean(base.GetProperty(name));
    internal int[] RawIds(string name) => ImageAssetPolicy.RawIds(this, name);
    public override string Path => _deletionPath.ReadPath(this, base.Path);
    protected override void OnLoaded(object sender, NodeEventArgs e)
    {
        using var profile = ImagePolicyDiagnostics.Measure("SetLoaded", this);
        ImageAssetPolicy.AssertOpen(this); base.OnLoaded(sender, e);
    }
    public override object GetProperty(string name)
    {
        using var profile = ImagePolicyDiagnostics.Measure("SetProperty", this);
        ImageAssetPolicy.AssertOpen(this); return base.GetProperty(name);
    }
    public override AsyncTask SaveAsync(NodeSaveSettings settings, CancellationToken cancel) =>
        ImageAssetPolicy.MutateAsync(async () =>
        {
            ImageAssetPolicy.AssertSetWrite(this);
            await base.SaveAsync(settings, cancel).ConfigureAwait(false);
        }, cancel);
    public override void MoveTo(Node target) => throw ImageAssetPolicy.Invalid();
    public override void CopyTo(Node target) => throw ImageAssetPolicy.Invalid();
    public override void CopyTo(Node target, string newName) => throw ImageAssetPolicy.Invalid();
    public override Node MakeCopy(Node target, string newName) => throw ImageAssetPolicy.Invalid();
    protected override void OnMoving(object sender, CancellableNodeOperationEventArgs e) => throw ImageAssetPolicy.Invalid();
    protected override void OnCopying(object sender, CancellableNodeOperationEventArgs e) => throw ImageAssetPolicy.Invalid();
    protected override void OnDeletingPhysically(object sender, CancellableNodeEventArgs e)
    {
        ImageAssetPolicy.AssertSetDelete(this); base.OnDeletingPhysically(sender, e);
    }
    public override AsyncTask DeleteAsync(bool bypassTrash, CancellationToken cancel)
    {
        if (!bypassTrash) throw new InvalidOperationException("M0 image sets require explicit permanent deletion.");
        return ForceDeleteAsync(cancel);
    }
    public override AsyncTask ForceDeleteAsync(CancellationToken cancel) =>
        ImageAssetPolicy.MutateAsync(async () =>
        {
            ImageAssetPolicy.AssertSetDelete(this);
            using var scope = _deletionPath.Begin(this, () => base.Path);
            await base.ForceDeleteAsync(cancel).ConfigureAwait(false);
        }, cancel);
}
