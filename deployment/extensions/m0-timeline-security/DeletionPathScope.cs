using System;
using System.Threading;
using SenseNet.Configuration;
using SenseNet.ContentRepository.Storage;
using SenseNet.ContentRepository.Storage.Security;
using SenseNet.Security;
using PermissionType = SenseNet.ContentRepository.Storage.Security.PermissionType;

namespace Timeline.Theories.M0.Security;

/// <summary>
/// Keeps only the already authorized path available to the same deletion flow
/// after stock physical deletion removes the node's security entity.
/// </summary>
internal sealed class DeletionPathScope
{
    // This holder belongs to one concrete handler instance. AsyncLocal also
    // prevents parallel requests sharing that instance from adopting its scope.
    private readonly AsyncLocal<Authorization?> _current = new();

    public IDisposable Begin(Node node, Func<string> readPath)
    {
        DomainReadPolicy.AssertOpen(node);
        var caller = AccessProvider.Current.GetOriginalUser();
        if (!Providers.Instance.SecurityHandler.HasPermission(caller, node.Id,
                PermissionType.Delete))
            throw new SenseNetSecurityException("M0 content delete is not permitted.");

        var authorization = new Authorization(this, _current.Value, node,
            caller.Id, readPath());
        _current.Value = authorization;
        return authorization;
    }

    public string ReadPath(Node node, string rawPath)
    {
        try
        {
            DomainReadPolicy.AssertOpen(node);
        }
        catch (EntityNotFoundException) when (TryGetDeletedPath(node, out var capturedPath))
        {
            return capturedPath;
        }

        return rawPath;
    }

    private bool TryGetDeletedPath(Node node, out string path)
    {
        var authorization = _current.Value;
        if (authorization is not null && authorization.IsActive &&
            node.IsDeleted && ReferenceEquals(authorization.Node, node) &&
            authorization.CallerId == AccessProvider.Current.GetOriginalUser().Id)
        {
            path = authorization.Path;
            return true;
        }

        path = string.Empty;
        return false;
    }

    private sealed class Authorization : IDisposable
    {
        private readonly DeletionPathScope _owner;
        private readonly Authorization? _previous;
        private int _active = 1;

        public Authorization(DeletionPathScope owner, Authorization? previous,
            Node node, int callerId, string path)
        {
            _owner = owner;
            _previous = previous;
            Node = node;
            CallerId = callerId;
            Path = path;
        }

        public Node Node { get; }
        public int CallerId { get; }
        public string Path { get; }
        public bool IsActive => Volatile.Read(ref _active) == 1;

        public void Dispose()
        {
            // Invalidate captured child execution contexts as well as removing
            // this flow's value. Nested stock deletion restores its outer scope.
            if (Interlocked.Exchange(ref _active, 0) == 0)
                return;
            if (ReferenceEquals(_owner._current.Value, this))
                _owner._current.Value = _previous;
        }
    }
}
