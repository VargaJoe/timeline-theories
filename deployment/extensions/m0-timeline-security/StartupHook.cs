/// <summary>
/// Explicit local .NET startup-hook entry point. The method deliberately has no
/// dependency calls: loading this exact assembly by path before Main makes it
/// resolvable by ASP.NET hosting-startup discovery without editing host deps.
/// Enabled only by the owned M0 container's DOTNET_STARTUP_HOOKS setting.
/// </summary>
internal static class StartupHook
{
    public static void Initialize() { }
}
