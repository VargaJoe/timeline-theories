using System;
using System.Linq;
using System.Threading;
using SenseNet.Configuration;
using SenseNet.ContentRepository.Storage;
using SenseNet.ContentRepository.Storage.Events;
using PermissionType = SenseNet.ContentRepository.Storage.Security.PermissionType;

namespace Timeline.Theories.M0.Security;

/// <summary>
/// Enforces the asset tree boundary for stock types too. In particular, stock
/// SystemFolder/TrashBag exceptions cannot create unguarded descendants. Other
/// content trees and ordinary modifications of ancestors remain unaffected.
/// Registered explicitly by ImageAssetHostingStartup in the isolated M0 host.
/// </summary>
public sealed class ImageAssetScopeObserver : NodeObserver
{
    private static bool Inside(string path) => path == ImageAssetPolicy.AssetsPath ||
        path.StartsWith(ImageAssetPolicy.AssetsPath + "/", StringComparison.Ordinal);
    private static bool Ancestor(string path) =>
        ImageAssetPolicy.AssetsPath.StartsWith(path + "/", StringComparison.Ordinal);
    private static bool AssetsExist() => Providers.Instance.DataProvider
        .NodeExistsAsync(ImageAssetPolicy.AssetsPath, CancellationToken.None)
        .ConfigureAwait(false).GetAwaiter().GetResult();
    private static string ProspectivePath(Node node) =>
        RepositoryPath.Combine(RepositoryPath.GetParentPath(node.Path), node.Name);

    protected override void OnNodeCreating(object sender, CancellableNodeEventArgs e)
    {
        var node = e.SourceNode;
        var path = ProspectivePath(node);
        if (!Inside(path)) return;
        if (node.CopyInProgress) throw ImageAssetPolicy.Invalid();
        if (path == ImageAssetPolicy.AssetsPath)
        {
            if (node.NodeType.Name != "Folder") throw ImageAssetPolicy.Invalid();
            ImageAssetPolicy.Permission(node.ParentId, PermissionType.AddNew);
            return;
        }
        var segments = path.Substring(ImageAssetPolicy.AssetsPath.Length + 1).Split('/');
        if (segments.Length == 1)
        {
            if (node.NodeType.Name != "Folder" || !int.TryParse(segments[0], out var ownerId) ||
                ownerId <= 0 || segments[0] != ownerId.ToString()) throw ImageAssetPolicy.Invalid();
            ImageAssetPolicy.ReadOwner(ownerId);
            ImageAssetPolicy.Permission(ownerId, PermissionType.Save);
            ImageAssetPolicy.Permission(node.ParentId, PermissionType.AddNew);
        }
        else if (segments.Length == 2 && node is ImageVariantSetSecurityHandler set && node.NodeType.Name == "ImageVariantSet")
            ImageAssetPolicy.AssertSetWrite(set);
        else if (segments.Length == 3 && node is ImageVariantSecurityHandler file && node.NodeType.Name == "ImageVariant")
            ImageAssetPolicy.AssertFileWrite(file);
        else throw ImageAssetPolicy.Invalid();
    }

    protected override void OnNodeModifying(object sender, CancellableNodeEventArgs e)
    {
        var node = e.SourceNode;
        var proposed = ProspectivePath(node);
        var path = node.Path;
        if ((Inside(path) || Inside(proposed) || (Ancestor(path) && AssetsExist())) &&
            (node.IsPropertyChanged("Name") || proposed != path)) throw ImageAssetPolicy.Invalid();
        if (!Inside(path)) return;
        if (node is ImageVariantSetSecurityHandler set) ImageAssetPolicy.AssertSetWrite(set);
        else if (node is ImageVariantSecurityHandler file) ImageAssetPolicy.AssertFileWrite(file);
        else if (node.NodeType.Name != "Folder" ||
                 path.Substring(ImageAssetPolicy.AssetsPath.Length).Count(c => c == '/') > 1)
            throw ImageAssetPolicy.Invalid();
    }

    protected override void OnNodeCopying(object sender, CancellableNodeOperationEventArgs e)
    {
        if (Inside(e.SourceNode.Path) || Inside(e.TargetNode.Path) ||
            (Ancestor(e.SourceNode.Path) && AssetsExist())) throw ImageAssetPolicy.Invalid();
    }

    protected override void OnNodeMoving(object sender, CancellableNodeOperationEventArgs e)
    {
        if (Inside(e.SourceNode.Path) || Inside(e.TargetNode.Path) ||
            (Ancestor(e.SourceNode.Path) && AssetsExist())) throw ImageAssetPolicy.Invalid();
    }

    protected override void OnNodeRestoring(object sender, CancellableNodeEventArgs e)
    {
        // Stock MoveTo(FromTrash) puts the destination parent in SourceNode;
        // ordinary MoveTo instead exposes TargetNode. No restore is an import
        // shortcut into the strictly typed asset tree.
        if (Inside(e.SourceNode.Path)) throw ImageAssetPolicy.Invalid();
        if (sender is Node source && (Inside(source.Path) ||
            (Ancestor(source.Path) && AssetsExist()))) throw ImageAssetPolicy.Invalid();
    }

    // Stock MoveTo(ToTrash) puts the new TrashBag in e.SourceNode, while sender
    // remains the actual content being deleted. Check that actual source.
    protected override void OnNodeDeleting(object sender, CancellableNodeEventArgs e) => AssertDeletion(sender as Node ?? e.SourceNode);
    protected override void OnNodeDeletingPhysically(object sender, CancellableNodeEventArgs e) => AssertDeletion(sender as Node ?? e.SourceNode);
    private static void AssertDeletion(Node node)
    {
        if (Ancestor(node.Path) && AssetsExist()) throw ImageAssetPolicy.Invalid();
        if (!Inside(node.Path)) return;
        if (node is ImageVariantSetSecurityHandler set)
        {
            ImageAssetPolicy.AssertSetDelete(set); return;
        }
        // Empty protected scaffolding can be removed by its actual authorized
        // caller after sets are gone; ancestor bulk deletion is never a shortcut.
        if (node.NodeType.Name != "Folder" ||
            node.Path.Substring(ImageAssetPolicy.AssetsPath.Length).Count(c => c == '/') > 1 ||
            Providers.Instance.DataProvider.GetChildrenIdentifiersAsync(node.Id, CancellationToken.None)
                .ConfigureAwait(false).GetAwaiter().GetResult().Any()) throw ImageAssetPolicy.Invalid();
        ImageAssetPolicy.Permission(node.Id, PermissionType.Delete);
    }
}
