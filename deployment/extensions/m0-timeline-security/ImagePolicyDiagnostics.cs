using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using System.Threading;
using Microsoft.AspNetCore.Http;
using SenseNet.ContentRepository.Storage;
using SenseNet.ContentRepository.Storage.Security;

namespace Timeline.Theories.M0.Security;

/// <summary>
/// Opt-in local M0 measurements only. No decisions, cache, content, credentials
/// or request headers are retained. Disabled requests take a single item lookup.
/// </summary>
internal static class ImagePolicyDiagnostics
{
    private static readonly HttpContextAccessor Accessor = new();
    private static readonly object Key = new();
    private static readonly object Disabled = new();

    internal static Scope Measure(string name, Node? node = null)
    {
        var context = Accessor.HttpContext;
        if (context is null) return default;
        if (node is not null && !context.Items.ContainsKey(Key)) Initialize(context, node);
        return context.Items.TryGetValue(Key, out var value) && value is State state
            ? new Scope(state.Metrics.GetOrAdd(name, static _ => new Metric())) : default;
    }

    private static void Initialize(HttpContext context, Node node)
    {
        lock (context.Items)
        {
            if (context.Items.ContainsKey(Key)) return;
            context.Items[Key] = Disabled;
            if (!context.Request.Host.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
                context.Request.Host.Port != 41016 || context.Request.Scheme != "https" ||
                node.NodeType.Name is not ("ImageVariant" or "ImageVariantSet") ||
                !Guid.TryParseExact(context.Request.Query["m0ImagePolicyProfile"].ToString(), "D", out var id) ||
                !AccessProvider.Current.GetOriginalUser().IsAuthenticated) return;
            var path = context.Request.Path.Value ?? "";
            if (!path.StartsWith("/OData.svc/", StringComparison.OrdinalIgnoreCase) &&
                !path.Equals("/binaryhandler.ashx", StringComparison.OrdinalIgnoreCase)) return;
            var state = new State(id);
            context.Items[Key] = state;
            context.Response.OnCompleted(() =>
            {
                // Constant metric names and numeric values only. Never include
                // paths, identities, headers, payloads or image bytes.
                Console.WriteLine("M0_IMAGE_POLICY_PROFILE " + JsonSerializer.Serialize(new
                {
                    requestId = state.Id,
                    elapsedMilliseconds = Math.Round(Stopwatch.GetElapsedTime(state.Start).TotalMilliseconds, 3),
                    counts = state.Metrics.OrderBy(pair => pair.Key).ToDictionary(pair => pair.Key,
                        pair => Interlocked.Read(ref pair.Value.Count)),
                    inclusiveMilliseconds = state.Metrics.OrderBy(pair => pair.Key).ToDictionary(pair => pair.Key,
                        pair => Math.Round(Interlocked.Read(ref pair.Value.Ticks) * 1000.0 / Stopwatch.Frequency, 3))
                }));
                return System.Threading.Tasks.Task.CompletedTask;
            });
        }
    }

    private sealed class State
    {
        internal Guid Id { get; }
        internal long Start { get; } = Stopwatch.GetTimestamp();
        internal ConcurrentDictionary<string, Metric> Metrics { get; } = new();
        internal State(Guid id) => Id = id;
    }

    internal sealed class Metric
    {
        internal long Count;
        internal long Ticks;
    }

    internal readonly struct Scope : IDisposable
    {
        private readonly Metric? _metric;
        private readonly long _start;
        internal Scope(Metric metric)
        {
            _metric = metric; _start = Stopwatch.GetTimestamp();
            Interlocked.Increment(ref metric.Count);
        }
        public void Dispose()
        {
            if (_metric is not null) Interlocked.Add(ref _metric.Ticks, Stopwatch.GetTimestamp() - _start);
        }
    }
}
