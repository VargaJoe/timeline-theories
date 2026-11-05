using System;
using System.Collections.Generic;
using System.Threading;
using Microsoft.AspNetCore.Http;
using SenseNet.ContentRepository.Storage;
using SenseNet.ContentRepository.Storage.Security;

namespace Timeline.Theories.M0.Security;

/// <summary>
/// Reuses only persisted dynamic data during one authenticated asset Upload's
/// locked Save. Each lookup still follows a fresh node head. Permissions,
/// versions, text, binary metadata and source stamps are never cached here.
/// </summary>
internal static class ImageSnapshotDataMemo
{
    private static readonly HttpContextAccessor Accessor = new();
    private static readonly AsyncLocal<State?> Current = new();

    internal readonly record struct Key(int Id, int VersionId, long Timestamp, int NodeTypeId)
    {
        internal static Key Capture(NodeHead head) => new(head.Id, head.LastMinorVersionId, head.Timestamp, head.NodeTypeId);
    }

    internal static UploadScope BeginUpload(ImageVariantSecurityHandler file)
    {
        var context = Accessor.HttpContext;
        var caller = AccessProvider.Current.GetOriginalUser();
        var path = context?.Request.Path.Value ?? "";
        if (context is null || !ImageAssetPolicy.HoldsMutationGate || !caller.IsAuthenticated ||
            file.NodeType.Name != "ImageVariant" || context.Request.Method != HttpMethods.Post ||
            !path.StartsWith("/OData.svc/", StringComparison.OrdinalIgnoreCase) ||
            !path.EndsWith("/Upload", StringComparison.OrdinalIgnoreCase)) return default;
        var previous = Current.Value;
        if (previous is not null && IsOwned(previous)) return default; // recursive stock Image Save
        var state = new State(context, caller.Id);
        Current.Value = state;
        return new UploadScope(state, previous);
    }

    internal static FreshScope Bypass()
    {
        var state = Current.Value;
        if (state is null || !IsOwned(state)) return default;
        Interlocked.Increment(ref state.BypassDepth);
        return new FreshScope(state);
    }

    internal static bool TryGet(Key key, out IDictionary<int, object>? data)
    {
        data = null;
        var state = Current.Value;
        if (state is null || !IsOwned(state)) return false;
        if (Volatile.Read(ref state.BypassDepth) > 0)
        {
            using var profile = ImagePolicyDiagnostics.Measure("SnapshotDataBypass");
            return false;
        }
        lock (state.Sync)
        {
            if (!state.Active) return false;
            if (state.Data.TryGetValue(key, out data))
            {
                using var profile = ImagePolicyDiagnostics.Measure("SnapshotDataHit");
                return true;
            }
        }
        using (ImagePolicyDiagnostics.Measure("SnapshotDataMiss")) return false;
    }

    internal static void StoreFresh(Key key, IDictionary<int, object> data)
    {
        var state = Current.Value;
        if (state is null || !IsOwned(state)) return;
        lock (state.Sync)
        {
            if (!state.Active || state.Data.Count >= 32 && !state.Data.ContainsKey(key)) return;
            // A forced fresh guard may seed or replace the same captured key.
            state.Data[key] = data;
        }
    }

    private static bool IsOwned(State state) => Volatile.Read(ref state.Active) &&
        ImageAssetPolicy.HoldsMutationGate && ReferenceEquals(Accessor.HttpContext, state.Context) &&
        AccessProvider.Current.GetOriginalUser().Id == state.CallerId;

    internal sealed class State
    {
        internal readonly HttpContext Context;
        internal readonly int CallerId;
        internal readonly object Sync = new();
        internal readonly Dictionary<Key, IDictionary<int, object>> Data = new();
        internal bool Active = true;
        internal int BypassDepth;
        internal State(HttpContext context, int callerId) { Context = context; CallerId = callerId; }
    }

    internal readonly struct UploadScope : IDisposable
    {
        private readonly State? _state;
        private readonly State? _previous;
        internal UploadScope(State state, State? previous) { _state = state; _previous = previous; }
        public void Dispose()
        {
            if (_state is null) return;
            lock (_state.Sync) { _state.Active = false; _state.Data.Clear(); }
            if (ReferenceEquals(Current.Value, _state)) Current.Value = _previous;
        }
    }

    internal readonly struct FreshScope : IDisposable
    {
        private readonly State? _state;
        internal FreshScope(State state) => _state = state;
        public void Dispose() { if (_state is not null) Interlocked.Decrement(ref _state.BypassDepth); }
    }
}
