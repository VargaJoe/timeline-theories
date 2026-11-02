using System;
using System.Buffers.Binary;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BinaryData = SenseNet.ContentRepository.Storage.BinaryData;

namespace Timeline.Theories.M0.Security;

/// <summary>
/// Deliberately narrow M0 decoder: non-interlaced 8-bit RGB/RGBA PNG. Validates
/// every chunk CRC, zlib checksum, complete decompressed raster and filters.
/// Pixel values are reconstructed, with fixed byte/pixel/decompression bounds.
/// JPEG/WebP/palette/animation support requires a separate decoder proof.
/// </summary>
internal static class PngVariantValidator
{
    internal static int Validate(BinaryData binary, JsonElement? expected)
    {
        if (binary is null || binary.ContentType != "image/png" || binary.Size is <= 0 or > 1048576)
            throw ImageAssetPolicy.Invalid();
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
        var bytes = output.ToArray();
        if (bytes.Length < 45 || !bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }))
            throw ImageAssetPolicy.Invalid();
        var offset = 8;
        int width = 0, height = 0, channels = 0;
        bool header = false, data = false, end = false;
        using var compressed = new MemoryStream();
        while (offset < bytes.Length)
        {
            if (bytes.Length - offset < 12) throw ImageAssetPolicy.Invalid();
            var lengthValue = BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(offset, 4));
            if (lengthValue > 1048576 || lengthValue > bytes.Length - offset - 12) throw ImageAssetPolicy.Invalid();
            var length = (int)lengthValue;
            var name = Encoding.ASCII.GetString(bytes, offset + 4, 4);
            var body = bytes.AsSpan(offset + 8, length);
            if (Crc(bytes.AsSpan(offset + 4, length + 4)) !=
                BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(offset + 8 + length, 4))) throw ImageAssetPolicy.Invalid();
            if (!header && name != "IHDR") throw ImageAssetPolicy.Invalid();
            switch (name)
            {
                case "IHDR":
                    if (header || length != 13) throw ImageAssetPolicy.Invalid();
                    var w = BinaryPrimitives.ReadUInt32BigEndian(body[..4]);
                    var h = BinaryPrimitives.ReadUInt32BigEndian(body.Slice(4, 4));
                    if (w is < 1 or > 4096 || h is < 1 or > 4096 || (long)w * h > 4194304 ||
                        body[8] != 8 || body[9] is not (2 or 6) || body[10] != 0 || body[11] != 0 || body[12] != 0)
                        throw ImageAssetPolicy.Invalid();
                    width = (int)w; height = (int)h; channels = body[9] == 2 ? 3 : 4; header = true;
                    break;
                case "IDAT":
                    if (end) throw ImageAssetPolicy.Invalid();
                    data = true; compressed.Write(body); break;
                case "IEND":
                    if (!data || end || length != 0 || offset + 12 != bytes.Length) throw ImageAssetPolicy.Invalid();
                    end = true; break;
                default:
                    // No metadata decompression, palette, animation, alternate
                    // critical semantics or ancillary payload in this proof.
                    throw ImageAssetPolicy.Invalid();
            }
            offset += length + 12;
        }
        if (!end || compressed.Length < 6) throw ImageAssetPolicy.Invalid();
        compressed.Position = 0;
        var stride = checked(width * channels);
        var row = new byte[stride];
        var previous = new byte[stride];
        using (var inflate = new ZLibStream(compressed, CompressionMode.Decompress, true))
        {
            for (var y = 0; y < height; y++)
            {
                var filter = inflate.ReadByte();
                if (filter is < 0 or > 4) throw ImageAssetPolicy.Invalid();
                inflate.ReadExactly(row);
                for (var x = 0; x < stride; x++)
                {
                    var a = x >= channels ? row[x - channels] : 0;
                    var b = previous[x];
                    var c = x >= channels ? previous[x - channels] : 0;
                    row[x] = unchecked((byte)(row[x] + (filter switch
                    {
                        0 => 0, 1 => a, 2 => b, 3 => (a + b) / 2, 4 => Paeth(a, b, c), _ => 0
                    })));
                }
                (previous, row) = (row, previous);
            }
            if (inflate.ReadByte() != -1) throw ImageAssetPolicy.Invalid();
        }
        if (expected is { } entry &&
            (entry.GetProperty("width").GetInt32() != width || entry.GetProperty("height").GetInt32() != height ||
             entry.GetProperty("mimeType").GetString() != "image/png" ||
             entry.GetProperty("byteLength").GetInt32() != bytes.Length ||
             entry.GetProperty("sha256").GetString() != Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()))
            throw ImageAssetPolicy.Invalid();
        return bytes.Length;
    }

    private static int Paeth(int a, int b, int c)
    {
        var p = a + b - c;
        var pa = Math.Abs(p - a); var pb = Math.Abs(p - b); var pc = Math.Abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }

    private static uint Crc(ReadOnlySpan<byte> data)
    {
        uint crc = 0xffffffff;
        foreach (var value in data)
        {
            crc ^= value;
            for (var bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ ((crc & 1) != 0 ? 0xedb88320U : 0);
        }
        return ~crc;
    }

}
