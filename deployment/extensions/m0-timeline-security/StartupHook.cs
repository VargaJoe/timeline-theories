/// <summary>
/// Dependency-free explicit preload of this extension only. The image decoder
/// is loaded later in its own AssemblyLoadContext, never in the host context.
/// </summary>
internal static class StartupHook
{
    public static void Initialize() { }
}
