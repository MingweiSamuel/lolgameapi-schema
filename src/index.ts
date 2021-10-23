import fs from 'fs/promises';
import path from 'path';
import { createCompoundSchema, areSchemasEqual } from 'genson-js';
import type { ValueType } from 'genson-js';

export const LOL_VERSION = '11.21';

export type RefSchema = {
    type?: ValueType | ValueType[];
    items?: RefSchema;
    properties?: Record<string, RefSchema>;
    required?: string[];
    anyOf?: Array<RefSchema>;
    $ref?: string,
};

export type EndpointDatum = {
    name: string,
    retval: {
        $ref: string,
    },
};

function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatRef(name: string): string {
    return `#/components/schemas/${name}`;
}

/**
 * Renames a specific schema in a normalized schema dict, and updates all `$ref`s.
 * @param before Name before.
 * @param after Name after.
 * @param schemas Schema dict.
 */
function renameSchema(before: string, after: string, schemas: Record<string, RefSchema>): void {
    if (before === after) return;

    schemas[after] = schemas[before];
    delete schemas[before];

    const afterRef = formatRef(after);
    const beforeRef = formatRef(before);

    for (const schema of Object.values(schemas)) {
        if ('object' === schema.type && null != schema.properties) {
            for (const propSchema of Object.values(schema.properties)) {
                if (beforeRef === propSchema.$ref) {
                    propSchema.$ref = afterRef;
                }
                else if ('array' === propSchema.type) {
                    if (null != propSchema.items && beforeRef === propSchema.items.$ref) {
                        propSchema.items.$ref = afterRef;
                    }
                }
            }
        }
    }
}

/**
 * Converts a schema with nested objects to a flat representation with `$ref`s.
 * @param name Name of the root object.
 * @param schema Schema of root object.
 * @returns Dictionary of named schemas.
 */
function normalizeSchema(name: string, schema: RefSchema): Record<string, RefSchema> {
    function helper(name: string, schema: RefSchema, output: Record<string, RefSchema>): RefSchema {
        if ('object' === schema.type && null != schema.properties) {
            for (const [ propName, propSchema ] of Object.entries(schema.properties)) {
                const subSchemaName = `${name}.${capitalize(propName)}`;
                schema.properties[propName] = helper(subSchemaName, propSchema, output);
            }
            output[name] = schema;
            return {
                $ref: formatRef(name),
            };
        }
        else if ('array' === schema.type && null != schema.items) {
            schema.items = helper(`${name}.0`, schema.items, output);
        }
        return schema;
    }
    const output: Record<string, RefSchema> = {};
    helper(name, schema, output);
    return output;
}

/**
 * Combines schemas which are equal.
 * @param schemas Dict of schemas.
 */
function consolidateSchemas(schemas: Record<string, RefSchema>): void {
    outer:
    while (1) {
        const entries = Object.entries(schemas);
        entries.sort(([ nameA ], [ nameB ]) => nameA.localeCompare(nameB));

        for (let b = 1; b < entries.length; b++) {
            const [ nameB, schemaB ] = entries[b];
            for (let a = 0; a < b; a++) {
                const [ nameA, schemaA ] = entries[a];

                // TODO: this might not understand `$ref`s.
                if (areSchemasEqual(schemaB, schemaA)) {
                    console.log(`Consolidating: ${nameA} <- ${nameB}`);
                    renameSchema(nameB, nameA, schemas);
                    continue outer;
                }
            }
        }
        break;
    }
}

async function main() {
    // Read example jsons.
    const dataDir = path.join(__dirname, '../data');
    const dir = path.join(dataDir, LOL_VERSION, 'liveclientdata/allgamedata');
    const files = await fs.readdir(dir);
    const filePromises = files.map(file => fs.readFile(path.join(dir, file), 'utf-8'));
    const fileObjects = (await Promise.all(filePromises)).map(content => JSON.parse(content));

    // Create nested schema.
    const schema = createCompoundSchema(fileObjects);

    // Process into normalized schema, consolidate identical objects.
    const schemas = normalizeSchema('LiveClientData.AllGameData', schema);
    consolidateSchemas(schemas);

    // Rename schemas.
    {
        const RENAMES: Record<string, string> = JSON.parse(await fs.readFile(path.join(dataDir, 'renames.json'), 'utf-8'));
        for (const [ before, after ] of Object.entries(RENAMES)) {
            console.log(`Renaming: ${after} <- ${before}`);
            renameSchema(before, after, schemas);
        }
    }

    // Read and cleanup base OpenAPI JSON.
    const openapi: any = JSON.parse(await fs.readFile(path.join(dataDir, 'openapi.json'), 'utf-8'));
    {
        for (const pathInfo of Object.values(openapi.paths)) {
            for (const pathVerb of Object.values(pathInfo as any)) {
                for (const paramInfo of (pathVerb as any).parameters) {
                    paramInfo.schema = { type: paramInfo.type, enum: paramInfo.enum, format: paramInfo.format };
                    delete paramInfo.type;
                    delete paramInfo.enum;
                    delete paramInfo.format;
                }
            }
        }
    }

    // Read OpenAPI spec and update endpoint returns.
    const ENDPOINT_DATA: Record<string, EndpointDatum> = JSON.parse(await fs.readFile(path.join(dataDir, 'endpointData.json'), 'utf-8'));

    {
        openapi.components.schemas = schemas;
        openapi.paths = Object.fromEntries(Object.entries(openapi.paths)
            .filter(([ path, pathInfo ]: [ string, any ]) => {
                const endpointDatum = ENDPOINT_DATA[path];
                if (undefined === endpointDatum) return false;
                // TODO handle endpoints properly.
                pathInfo['x-endpoint'] = 'LiveClientData';
                pathInfo.get.operationId = 'LiveClientData.get' + endpointDatum.name;
                if (endpointDatum.retval)
                    pathInfo.get.responses['200'].content['application/json'].schema = endpointDatum.retval;
                return true;
            }));
        openapi.info.description = 'League of Legends game client Live Client Data API';
        openapi.info.title = 'LoL Live Client Data'
    }

    const content = JSON.stringify(openapi, null, 2);
    await Promise.all([
        './openapi.json',
        './openapi-lcd.json',
    ].map(file => fs.writeFile(file, content)));
}
main().catch(console.error);
