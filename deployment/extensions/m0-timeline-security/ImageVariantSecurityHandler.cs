using System.Threading;
using SenseNet.ContentRepository;
using SenseNet.ContentRepository.Schema;
using SenseNet.ContentRepository.Storage;
using SenseNet.ContentRepository.Storage.Events;
using AsyncTask = System.Threading.Tasks.Task;

namespace Timeline.Theories.M0.Security;

[ContentHandler]
public class ImageVariantSecurityHandler : Image
{
    public ImageVariantSecurityHandler(Node parent) : this(parent, "ImageVariant") { }
    public ImageVariantSecurityHandler(Node parent, string nodeTypeName) : base(parent, nodeTypeName) { }
    protected ImageVariantSecurityHandler(NodeToken token) : base(token) { }
    internal string RawPath => base.Path;
    internal SenseNet.ContentRepository.Storage.BinaryData RawBinary => base.Binary;
    public override string Name
    {
        // Stock Image.GetImageStream uses GetBinary (nonvirtual) for an explicit
        // Binary property, but reads virtual Name before returning the stream.
        get { ImageAssetPolicy.AssertOpen(this); return base.Name; }
        set { base.Name = value; }
    }
    public override string Path { get { ImageAssetPolicy.AssertOpen(this); return base.Path; } }
    public override SenseNet.ContentRepository.Storage.BinaryData Binary
    {
        get { ImageAssetPolicy.AssertOpen(this); return base.Binary; }
        set { base.Binary = value; }
    }
    protected override void OnLoaded(object sender, NodeEventArgs e)
    {
        ImageAssetPolicy.AssertOpen(this); base.OnLoaded(sender, e);
    }
    public override object GetProperty(string name)
    {
        ImageAssetPolicy.AssertOpen(this); return base.GetProperty(name);
    }
    public override AsyncTask SaveAsync(NodeSaveSettings settings, CancellationToken cancel) =>
        ImageAssetPolicy.MutateAsync(async () =>
        {
            ImageAssetPolicy.AssertFileWrite(this);
            await base.SaveAsync(settings, cancel).ConfigureAwait(false);
        }, cancel);
    public override void MoveTo(Node target) => throw ImageAssetPolicy.Invalid();
    public override void CopyTo(Node target) => throw ImageAssetPolicy.Invalid();
    public override void CopyTo(Node target, string newName) => throw ImageAssetPolicy.Invalid();
    public override Node MakeCopy(Node target, string newName) => throw ImageAssetPolicy.Invalid();
    protected override void OnMoving(object sender, CancellableNodeOperationEventArgs e) => throw ImageAssetPolicy.Invalid();
    protected override void OnCopying(object sender, CancellableNodeOperationEventArgs e) => throw ImageAssetPolicy.Invalid();
    // Whole inactive sets have one bounded deletion/preflight path. Individual
    // files cannot silently make a generation incomplete, even for editors.
    protected override void OnDeletingPhysically(object sender, CancellableNodeEventArgs e) => throw ImageAssetPolicy.Invalid();
    public override AsyncTask DeleteAsync(bool bypassTrash, CancellationToken cancel) => throw ImageAssetPolicy.Invalid();
    public override AsyncTask ForceDeleteAsync(CancellationToken cancel) => throw ImageAssetPolicy.Invalid();
}
