using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using SenseNet.Configuration;
using SenseNet.ContentRepository;
using SenseNet.ContentRepository.Schema;
using SenseNet.ContentRepository.Storage;
using SenseNet.ContentRepository.Storage.Events;
using SenseNet.ContentRepository.Storage.Security;
using SenseNet.Security;
using AsyncTask = System.Threading.Tasks.Task;
using StorageDataType = SenseNet.ContentRepository.Storage.Schema.DataType;
using PermissionType = SenseNet.ContentRepository.Storage.Security.PermissionType;

namespace Timeline.Theories.M0.Security;

/// <summary>
/// Local M0 policy for the Timeline CTD. This handler protects ordinary OData
/// create/PATCH and binary saves without delegating SetPermissions to editors.
/// The canonical Timelines container must provide public read grants locally
/// only, so every new child starts closed before its first persistence.
/// </summary>
[ContentHandler]
public class TimelineSecurityHandler : Folder
{
    public const string TimelinesPath = "/Root/Content/timelines/Timelines";
    public const string VisitorPath = "/Root/IMS/BuiltIn/Portal/Visitor";
    public const string ReaderPath = "/Root/IMS/BuiltIn/Portal/M0Reader";

    // M0 has one repository process. Serialize saves, including new nodes that
    // do not yet have an Id, to prevent interleaved hide/publish ACL updates.
    private static readonly SemaphoreSlim SaveGate = new(1, 1);
    private readonly DeletionPathScope _deletionPath = new();
    private static readonly PermissionTypeBase[] ReadPermissions =
    {
        PermissionType.See, PermissionType.Open, PermissionType.OpenMinor,
        PermissionType.SeePermissions
    };
    private static readonly ulong ReadMask = ReadPermissions.Aggregate(0UL,
        (mask, permission) => mask | permission.Mask);

    public TimelineSecurityHandler(Node parent) : this(parent, "Timeline") { }
    public TimelineSecurityHandler(Node parent, string nodeTypeName)
        : base(parent, nodeTypeName) { }
    protected TimelineSecurityHandler(NodeToken token) : base(token) { }

    public override string Path
    {
        get => _deletionPath.ReadPath(this, base.Path);
    }

    public override async AsyncTask DeleteAsync(bool bypassTrash, CancellationToken cancellationToken)
    {
        using var scope = _deletionPath.Begin(this, () => base.Path);
        await base.DeleteAsync(bypassTrash, cancellationToken).ConfigureAwait(false);
    }

    public override async AsyncTask ForceDeleteAsync(CancellationToken cancellationToken)
    {
        using var scope = _deletionPath.Begin(this, () => base.Path);
        await base.ForceDeleteAsync(cancellationToken).ConfigureAwait(false);
    }

    protected override void OnLoaded(object sender, NodeEventArgs e)
    {
        DomainReadPolicy.AssertOpen(this);
        base.OnLoaded(sender, e);
    }

    public override object GetProperty(string name)
    {
        DomainReadPolicy.AssertOpen(this);
        return base.GetProperty(name);
    }

    // This is the extension point recommended by GenericContent. OnModified
    // is skipped for some locked saves; this override also covers those saves.
    public override async AsyncTask SaveAsync(NodeSaveSettings settings,
        CancellationToken cancellationToken)
    {
        await SaveGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            AssertPolicyScope();
            var isNew = Id == 0;

            // The framework's AssertSaving happens after pre-save events.
            // Check the concrete caller/target before any elevated ACL change.
            var caller = AccessProvider.Current.GetOriginalUser();
            var security = Providers.Instance.SecurityHandler;
            if (!security.HasPermission(caller, isNew ? Parent.Id : Id,
                    isNew ? PermissionType.AddNew : PermissionType.Save))
                throw new SenseNetSecurityException("M0 Timeline save is not permitted.");

            if (isNew)
                await AssertPrivateInheritanceAsync(cancellationToken)
                    .ConfigureAwait(false);
            else
            {
                // NodeData saves every short/integer property, including
                // unchanged values loaded before waiting for this gate. Keep
                // concurrent visibility changes when this request did not
                // modify that field itself.
                var current = await ReadPersistedVisibilityAsync(cancellationToken)
                    .ConfigureAwait(false);
                var visibleProperty = GetVisibilityPropertyName("IsVisible");
                var hiddenProperty = GetVisibilityPropertyName("Hidden");
                if (!IsPropertyChanged(visibleProperty))
                    this[visibleProperty] = current.Visible ? 1 : 0;
                if (!IsPropertyChanged(hiddenProperty))
                    this[hiddenProperty] = current.Hidden ? 1 : 0;

                // Revocation also protects failed saves. The policy can grant
                // public read only after a fresh successful persisted read.
                await ApplyReadPolicyAsync(false, cancellationToken)
                    .ConfigureAwait(false);
            }

            ReadPublicFlag(); // Validate the two Boolean field definitions.

            // A failed private save leaves the existing node closed. A failed
            // public save never removes its existing private ACL.
            await base.SaveAsync(settings, cancellationToken).ConfigureAwait(false);

            var persisted = await ReadPersistedVisibilityAsync(cancellationToken)
                .ConfigureAwait(false);
            if (!persisted.Visible || persisted.Hidden)
            {
                if (isNew)
                    await ApplyReadPolicyAsync(false, cancellationToken)
                        .ConfigureAwait(false);
            }
            else if (persisted.Approved && SavingState == ContentSavingState.Finalized)
            {
                // Publishing becomes readable only after the field/version
                // save succeeds. ACL failure therefore leaves it closed.
                await ApplyReadPolicyAsync(true, cancellationToken)
                    .ConfigureAwait(false);
            }
        }
        finally
        {
            SaveGate.Release();
        }
    }

    private void AssertPolicyScope()
    {
        if (!string.Equals(NodeType.Name, "Timeline", StringComparison.Ordinal) ||
            !Path.StartsWith(TimelinesPath + "/", StringComparison.Ordinal) ||
            (Id == 0 && !string.Equals(Parent.Path, TimelinesPath,
                StringComparison.Ordinal)))
            throw new InvalidOperationException("M0 Timeline security scope rejected the save.");
    }

    private bool ReadPublicFlag()
    {
        var content = Content.Create(this);
        if (!content.Fields.TryGetValue("IsVisible", out var visibleField) ||
            !content.Fields.TryGetValue("Hidden", out var hiddenField) ||
            visibleField.GetData() is not bool visible ||
            hiddenField.GetData() is not bool hidden)
            throw new InvalidOperationException("M0 Timeline visibility fields are invalid.");
        return visible && !hidden;
    }

    private async Task<(bool Visible, bool Hidden, bool Approved)> ReadPersistedVisibilityAsync(
        CancellationToken cancellationToken)
    {
        // Use the public data provider API directly, bypassing request L2 and
        // shared NodeData caches. This is a fixed-node read after caller auth.
        using (new SystemAccount())
        {
            var provider = Providers.Instance.DataProvider;
            var head = await provider.LoadNodeHeadAsync(Id, cancellationToken)
                .ConfigureAwait(false);
            if (head is null || head.LastMinorVersionId <= 0)
                throw new InvalidOperationException("M0 Timeline persisted version is missing.");
            var nodes = await provider.LoadNodesAsync(new[] { head.LastMinorVersionId },
                cancellationToken).ConfigureAwait(false);
            // This pinned storage version's GetDynamicDataNameKey incorrectly
            // treats property IDs as positional collection indexes. Use the
            // underlying ID-keyed bag and the validated schema property ID.
            var data = nodes.SingleOrDefault()?.GetDynamicDataIdKey();
            if (data is null)
                throw new InvalidOperationException("M0 Timeline persisted visibility is invalid.");
            var versions = await provider.GetVersionNumbersAsync(Id, cancellationToken)
                .ConfigureAwait(false);
            var version = versions.SingleOrDefault(item => item.VersionId == head.LastMinorVersionId);
            if (version is null)
                throw new InvalidOperationException("M0 Timeline persisted version metadata is missing.");
            var visible = ReadPersistedBoolean(data, "IsVisible");
            var hidden = ReadPersistedBoolean(data, "Hidden");
            var approved = version.VersionNumber.Status == VersionStatus.Approved;
            return (visible, hidden, approved);
        }
    }

    private string GetVisibilityPropertyName(string name)
    {
        var content = Content.Create(this);
        if (!content.Fields.TryGetValue(name, out var field) ||
            field.FieldSetting.Bindings is not { Count: 1 } bindings)
            throw new InvalidOperationException($"M0 Timeline {name} storage binding is invalid.");
        return bindings[0];
    }

    private bool ReadPersistedBoolean(
        System.Collections.Generic.IDictionary<int, object> data, string name)
    {
        var binding = GetVisibilityPropertyName(name);
        var property = NodeType.PropertyTypes.FirstOrDefault(item => item.Name == binding);
        if (property is null || property.DataType != StorageDataType.Int)
            throw new InvalidOperationException($"M0 Timeline persisted {name} schema is invalid.");

        // Raw NodeData contains only stored values. Match NodeData.LoadProperty
        // by applying the storage schema's Int default (0) when absent/null.
        var present = data.TryGetValue(property.Id, out var value);
        value ??= property.DefaultValue;
        if (value is int integer)
            return integer != 0;

        // Diagnostic metadata only: never include content values or identity
        // data in the exception returned to an API caller.
        throw new InvalidOperationException($"M0 Timeline persisted {name} type is invalid " +
            $"(present={present}, type={value?.GetType().FullName ?? "null"}).");
    }

    private static async Task<User[]> ReadSubjectsAsync(CancellationToken cancellationToken)
    {
        // Resolve fixed local identity paths; IDs are not assumed or imported.
        var visitor = await Node.LoadAsync<User>(VisitorPath, cancellationToken)
            .ConfigureAwait(false);
        var reader = await Node.LoadAsync<User>(ReaderPath, cancellationToken)
            .ConfigureAwait(false);
        if (visitor is null || reader is null)
            throw new InvalidOperationException("M0 Timeline read identities are not provisioned.");
        return new[] { visitor, reader };
    }

    private async AsyncTask AssertPrivateInheritanceAsync(CancellationToken cancellationToken)
    {
        // Read-only elevation follows the caller's AddNew check. Inspect the
        // inherited ACEs that the new node would receive, excluding grants
        // local to the container. Include each subject's actual group IDs.
        using (new SystemAccount())
        {
            var security = Providers.Instance.SecurityHandler;
            foreach (var subject in await ReadSubjectsAsync(cancellationToken)
                .ConfigureAwait(false))
            {
                var identities = security.GetGroups(subject);
                identities.Add(subject.Id);
                var entries = security.GetEffectiveEntriesAsSystemUser(
                    Parent.Id, identities.Distinct(), EntryType.Normal)
                    .Where(entry => !entry.LocalOnly).ToArray();
                var allowed = entries.Aggregate(0UL, (mask, entry) => mask | entry.AllowBits);
                var denied = entries.Aggregate(0UL, (mask, entry) => mask | entry.DenyBits);
                if ((allowed & ~denied & ReadMask) != 0)
                    throw new InvalidOperationException("M0 Timeline parent propagates public read permissions; creation refused.");
            }
        }
    }

    private async AsyncTask ApplyReadPolicyAsync(bool isPublic,
        CancellationToken cancellationToken)
    {
        // This block changes only the four read rights, for two fixed local
        // identities, on this verified Timeline. Caller permissions were
        // checked before entering this elevated block.
        using (new SystemAccount())
        {
            var editor = Providers.Instance.SecurityHandler.CreateAclEditor();
            foreach (var subject in await ReadSubjectsAsync(cancellationToken)
                .ConfigureAwait(false))
            {
                // Local-only and propagating rows are distinct. Clear both
                // to remove stale direct deny/allow bits before replacement.
                editor.ClearPermission(Id, subject.Id, true, ReadPermissions);
                editor.ClearPermission(Id, subject.Id, false, ReadPermissions);
                if (isPublic)
                    editor.Allow(Id, subject.Id, false, ReadPermissions);
                else
                    editor.Deny(Id, subject.Id, false, ReadPermissions);
            }
            await editor.ApplyAsync(cancellationToken).ConfigureAwait(false);
        }
    }
}
