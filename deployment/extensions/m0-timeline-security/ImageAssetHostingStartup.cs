using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using SenseNet.ContentRepository.Storage.Events;

[assembly: HostingStartup(typeof(Timeline.Theories.M0.Security.ImageAssetHostingStartup))]

namespace Timeline.Theories.M0.Security;

/// <summary>
/// Explicit M0 host prerequisite, enabled only by the local repository container
/// ASPNETCORE_HOSTINGSTARTUPASSEMBLIES setting. No assembly discovery assumption.
/// </summary>
public sealed class ImageAssetHostingStartup : IHostingStartup
{
    internal static bool ConfigureInvoked { get; private set; }
    internal static bool ServicesConfigured { get; private set; }
    public void Configure(IWebHostBuilder builder)
    {
        ConfigureInvoked = true;
        builder.ConfigureServices(services =>
        {
            services.AddHttpContextAccessor();
            services.AddSingleton<NodeObserver, ImageAssetScopeObserver>();
            ServicesConfigured = true;
        });
    }
}
