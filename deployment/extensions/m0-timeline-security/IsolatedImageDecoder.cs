using System;
using System.IO;
using System.Reflection;
using System.Runtime.Loader;
using System.Linq;

namespace Timeline.Theories.M0.Security;

/// <summary>Private managed + native dependency graph; no host Skia replacement.</summary>
internal static class IsolatedImageDecoder
{
    private static readonly Lazy<Type> Bridge = new(() =>
    {
        var directory = Path.Combine(Path.GetDirectoryName(typeof(IsolatedImageDecoder).Assembly.Location)!, "image-decoder");
        var context = new DecoderContext(directory);
        return context.LoadFromAssemblyPath(Path.Combine(directory, "Timeline.Theories.ImageDecoder.dll"))
            .GetType("Timeline.Theories.ImageDecoder.Decoder", true)!;
    });

    internal static void AssertAvailable()
    {
        if (Bridge.Value.GetMethod("Available")!.Invoke(null, null) is not true) throw ImageAssetPolicy.Invalid();
    }

    internal static int[] Decode(byte[] bytes) =>
        (int[])Bridge.Value.GetMethod("Decode")!.Invoke(null, new object[] { bytes })!;

    internal static object Diagnostics()
    {
        var values = (string[])Bridge.Value.GetMethod("Info")!.Invoke(null, null)!;
        var hostFile = Path.Combine(Path.GetDirectoryName(typeof(IsolatedImageDecoder).Assembly.Location)!, "SkiaSharp.dll");
        return new { isolation = "private-alc", managedVersion = values[0], nativeVersion = values[1], context = values[2],
            hostFileManagedVersion = File.Exists(hostFile) ? AssemblyName.GetAssemblyName(hostFile).Version?.ToString() : null,
            hostLoadedVersions = AssemblyLoadContext.Default.Assemblies.Where(a => a.GetName().Name == "SkiaSharp")
                .Select(a => a.GetName().Version!.ToString()).ToArray() };
    }

    private sealed class DecoderContext : AssemblyLoadContext
    {
        private readonly string _directory;
        internal DecoderContext(string directory) : base("TimelineImageDecoder", isCollectible: false) => _directory = directory;
        protected override Assembly? Load(AssemblyName name) => name.Name == "SkiaSharp"
            ? LoadFromAssemblyPath(Path.Combine(_directory, "SkiaSharp.dll")) : null;
        protected override IntPtr LoadUnmanagedDll(string name) => name == "libSkiaSharp"
            ? LoadUnmanagedDllFromPath(Path.Combine(_directory, "runtimes", "linux-x64", "native", "libSkiaSharp.so")) : IntPtr.Zero;
    }
}
