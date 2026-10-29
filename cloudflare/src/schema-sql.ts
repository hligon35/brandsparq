// SQLite preserves source line endings in sqlite_master definitions.
// Normalize only line endings; changes to SQL tokens must still fail validation.
export function canonicalSchemaSql(sql: string | null | undefined) {
  return sql?.replace(/\r\n?/g, "\n");
}
