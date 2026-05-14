/**
 * Schema transformation for Claude structured output compatibility.
 * Claude requires additionalProperties: false on all object types.
 */

export function transformSchemaForClaude(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return schema
  }

  if (Array.isArray(schema)) {
    return schema.map(transformSchemaForClaude)
  }

  const result: any = {}

  for (const key of Object.keys(schema)) {
    if (key === 'additionalProperties') {
      result[key] = false
    } else {
      result[key] = transformSchemaForClaude(schema[key])
    }
  }

  // If this is an object type without additionalProperties, add it
  if (result.type === 'object' && !('additionalProperties' in result)) {
    result.additionalProperties = false
  }

  return result
}
