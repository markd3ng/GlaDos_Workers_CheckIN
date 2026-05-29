export const PLACEHOLDER_DATABASE_ID: string;

export function stripJsonComments(input: string): string;
export function parseWranglerConfig(input: string): Record<string, any>;
export function getPrimaryD1Binding(config: Record<string, any>): Record<string, any>;
export function resolveDatabaseName(config: Record<string, any>, env?: Record<string, string | undefined>): string;
export function resolveProvidedDatabaseId(env?: Record<string, string | undefined>): string | undefined;
export function findDatabaseIdByName(listOutput: string, databaseName: string): string | undefined;
export function extractDatabaseId(value: unknown): string | undefined;
export function patchD1Binding(config: Record<string, any>, databaseName: string, databaseId: string): Record<string, any>;
export function formatConfig(config: Record<string, any>): string;
