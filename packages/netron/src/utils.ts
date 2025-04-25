export const getQualifiedName = (name: string, version?: string) => `${name}${version ? `:${version}` : ''}`;
