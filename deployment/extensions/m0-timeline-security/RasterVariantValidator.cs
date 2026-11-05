using System;
using System.Buffers.Binary;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using BinaryData = SenseNet.ContentRepository.Storage.BinaryData;

namespace Timeline.Theories.M0.Security;

/// <summary>Bounded complete pixel decoding, never signature-only acceptance.</summary>
internal static class RasterVariantValidator
{
    internal static void AssertAvailable()
    {
        IsolatedImageDecoder.AssertAvailable();
    }

    internal static int Validate(BinaryData binary, JsonElement? expected)
    {
        using var profile = ImagePolicyDiagnostics.Measure("RasterValidate");
        var bytes = Read(binary);
        var decoded = IsolatedImageDecoder.Decode(bytes);
        var mime = Mime(decoded);
        if (expected is null && binary.ContentType is "" or "application/octet-stream") binary.ContentType = mime;
        if ((mime == "image/jpeg" && (bytes.Length < 4 || bytes[0] != 255 || bytes[1] != 216 ||
                bytes[^2] != 255 || bytes[^1] != 217)) ||
            (mime == "image/webp" && (bytes.Length < 12 ||
                BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(4, 4)) != bytes.Length - 8)))
            throw ImageAssetPolicy.Invalid();
        if (binary.ContentType != mime) throw ImageAssetPolicy.Invalid();
        // Preserve the proof's strict PNG chunk/raster/CRC checks as well.
        if (mime == "image/png") PngVariantValidator.Validate(binary, expected);
        if (expected is JsonElement value &&
            (value.GetProperty("width").GetInt32() != decoded[1] ||
             value.GetProperty("height").GetInt32() != decoded[2] ||
             value.GetProperty("mimeType").GetString() != mime ||
             value.GetProperty("byteLength").GetInt32() != bytes.Length ||
             value.GetProperty("sha256").GetString() != Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()))
            throw ImageAssetPolicy.Invalid();
        return bytes.Length;
    }

    private static string Mime(int[] decoded) => (decoded.Length == 3 ? decoded[0] : 0) switch
    {
        3 => "image/webp", 2 => "image/jpeg", 1 => "image/png",
        _ => throw ImageAssetPolicy.Invalid()
    };

    private static byte[] Read(BinaryData binary)
    {
        if (binary is null || binary.Size is <= 0 or > 1048576) throw ImageAssetPolicy.Invalid();
        using var stream = binary.GetStream();
        if (stream is null) throw ImageAssetPolicy.Invalid();
        using var output = new MemoryStream();
        var buffer = new byte[8192];
        int count;
        while ((count = stream.Read(buffer, 0, buffer.Length)) > 0)
        {
            if (output.Length + count > 1048576) throw ImageAssetPolicy.Invalid();
            output.Write(buffer, 0, count);
        }
        return output.ToArray();
    }
}
