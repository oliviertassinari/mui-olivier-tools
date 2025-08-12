declare module 'libnpmorg' {
  interface LsOptions {
    '//registry.npmjs.org/:_authToken': string;
  }

  interface SetOptions {
    '//registry.npmjs.org/:_authToken': string;
  }

  interface Users {
    [username: string]: string;
  }

  export function ls(org: string, options: LsOptions): Promise<Users>;
  export function set(org: string, username: string, role: null, options: SetOptions): Promise<any>;

  const libnpmorg: {
    ls: typeof ls;
    set: typeof set;
  };

  export default libnpmorg;
}