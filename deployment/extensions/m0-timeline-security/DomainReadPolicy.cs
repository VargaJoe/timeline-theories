using System;
using SenseNet.Configuration;
using SenseNet.ContentRepository.Storage;
using SenseNet.ContentRepository.Storage.Security;
using PermissionType = SenseNet.ContentRepository.Storage.Security.PermissionType;

namespace Timeline.Theories.M0.Security;

/// <summary>
/// Fixed local domain read policy. It evaluates the original caller even when
/// a stock loader has entered SystemAccount; it never changes that context.
/// </summary>
internal static class DomainReadPolicy
{
    public static void AssertOpen(Node node)
    {
        var type = node.NodeType.Name;
        if (type is not ("Timeline" or "TimelineEntry" or "MediaItem" or "BookMediaItem"))
            throw new InvalidOperationException("M0 domain read policy scope is invalid.");

        // Unsaved content has no security entity. Normal AddNew/Save checks
        // and the Timeline's private-inheritance guard protect creation.
        if (node.Id == 0)
            return;

        var caller = AccessProvider.Current.GetOriginalUser();
        var security = Providers.Instance.SecurityHandler;
        if (!security.HasPermission(caller, node.Id, PermissionType.Open))
            throw new SenseNetSecurityException("M0 content open is not permitted.");

        // A stock elevated loader must not return a minor/unapproved version
        // merely because the caller can read an approved major version.
        if ((!node.Version.IsMajor || node.Version.Status != VersionStatus.Approved) &&
            !security.HasPermission(caller, node.Id, PermissionType.OpenMinor))
            throw new SenseNetSecurityException("M0 content version open is not permitted.");
    }
}
