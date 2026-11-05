using System;
using SkiaSharp;

namespace Timeline.Theories.ImageDecoder;

/// <summary>Private-context bridge. Only byte arrays and primitive results cross.</summary>
public static class Decoder
{
    public static bool Available() => SkiaSharpVersion.CheckNativeLibraryCompatible(true);
    public static string[] Info() => new[] { typeof(SKCodec).Assembly.GetName().Version!.ToString(),
        SkiaSharpVersion.Native.ToString(), System.Runtime.Loader.AssemblyLoadContext.GetLoadContext(typeof(SKCodec).Assembly)!.Name! };

    // Empty result means malformed/unsupported/bounds violation. Runtime or
    // dependency failures throw and must never be reported as input rejection.
    public static int[] Decode(byte[] bytes)
    {
        if (bytes.Length is < 1 or > 1048576) return Array.Empty<int>();
        using var data = SKData.CreateCopy(bytes);
        using var codec = SKCodec.Create(data);
        if (codec is null || codec.Info.Width is < 1 or > 4096 || codec.Info.Height is < 1 or > 4096 ||
            (long)codec.Info.Width * codec.Info.Height > 4194304 || codec.FrameCount > 1) return Array.Empty<int>();
        var format = codec.EncodedFormat switch
        {
            SKEncodedImageFormat.Png => 1, SKEncodedImageFormat.Jpeg => 2, SKEncodedImageFormat.Webp => 3, _ => 0
        };
        if (format == 0) return Array.Empty<int>();
        using var raster = new SKBitmap(new SKImageInfo(codec.Info.Width, codec.Info.Height,
            SKColorType.Rgba8888, SKAlphaType.Unpremul));
        if (raster.GetPixels() == IntPtr.Zero || codec.GetPixels(raster.Info, raster.GetPixels()) != SKCodecResult.Success)
            return Array.Empty<int>();
        return new[] { format, raster.Width, raster.Height };
    }
}
