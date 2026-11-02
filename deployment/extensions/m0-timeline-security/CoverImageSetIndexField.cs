using System;
using System.Collections.Generic;
using SenseNet.ContentRepository;
using SenseNet.ContentRepository.Storage;
using SenseNet.Search.Indexing;
using SenseNet.Search.Querying;

namespace Timeline.Theories.M0.Security;

/// <summary>
/// Index the persisted relation identifiers without loading target contents.
/// Source revocation must not erase an owner reference or prevent an unrelated
/// scalar save merely because the ordinary cover projection is unreadable.
/// </summary>
internal sealed class CoverImageSetIndexField : IIndexableField
{
    private readonly Node _owner;
    private readonly Field _field;
    private CoverImageSetIndexField(Node owner, Field field)
    {
        _owner = owner; _field = field;
    }

    internal static IEnumerable<IIndexableField> PreserveReference(Node owner,
        IEnumerable<IIndexableField> fields)
    {
        foreach (var field in fields)
            yield return string.Equals(field.Name, "CoverImageSet", StringComparison.Ordinal)
                ? new CoverImageSetIndexField(owner, field as Field ?? throw ImageAssetPolicy.Invalid())
                : field;
    }

    public string Name => _field.Name;
    public bool IsInIndex => _field.IsInIndex;
    public bool IsBinaryField => _field.IsBinaryField;
    public bool LocalizationEnabled => _field.LocalizationEnabled;
    public bool IsLocalized => _field.IsLocalized;
    public object GetData() => _field.GetData();
    public string GetStoredValue() => _field.GetStoredValue();

    public IEnumerable<IndexField> GetIndexFields(out string textExtract)
    {
        textExtract = string.Empty;
        var indexing = _field.FieldSetting.IndexingInfo ?? throw ImageAssetPolicy.Invalid();
        var ids = ImageAssetPolicy.RawIds(_owner, "CoverImageSet");
        return new[]
        {
            ids.Length == 0
                ? new IndexField(Name, SnQuery.NullReferenceValue, indexing.IndexingMode,
                    indexing.IndexStoringMode, indexing.TermVectorStoringMode)
                : new IndexField(Name, ids, indexing.IndexingMode,
                    indexing.IndexStoringMode, indexing.TermVectorStoringMode)
        };
    }
}
