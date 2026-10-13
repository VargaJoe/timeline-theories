export interface Profile {repositoryUrl:string;authority:string;authType:'auto'|'SNAuth'|'IdentityServer';clientId:string;projectRoot:string;writable:boolean;mode:string}
export function validateProfile(profile: Omit<Profile,'mode'>,mode:string): Profile;
export function readProfile(mode:string,basePath:string,env?:Record<string,string>):Profile;
export const publicEnvKeys:string[];
export function publicEnvDefines(env:Record<string,string>):Record<string,string>;
