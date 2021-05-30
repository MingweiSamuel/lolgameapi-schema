function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

const boundariesRegex = /(?:\b|[_-]+|(?<=[a-z])(?=[A-Z])|(?=[A-Z][a-z]))/gm;
function camelCase(str) {
    return str.split(boundariesRegex)
        .map(capitalize)
        .join('');
}

/**
 * Returns intersection of two arrays.
 * @param {any[]} a
 * @param {any[]} b
 * @returns {any[]}
 */
function intersect(a, b) {
    return a.filter(x => b.includes(x));
}

// suB-type, suPer-type.
function isSubType(b, p) {
    if (b === p)
        return true;
    if (!p || !b)
        return false;

    // Special handler for integers subset of numbers.
    if ('number' === p.type && 'integer' === b.type)
        return true;

    if (b.type !== p.type)
        return false;
    if (b.$ref !== p.$ref)
        return false;

    if ('array' === b.type) {
        // Jail-free card if sub array is empty.
        if (0 === b.items.length) // || 0 === p.items.length)
            return true;
        if (b.items.length !== p.items.length)
            return false;
        for (let i = 0; i < b.items.length; i++) {
            if (!isSubType(b.items[0], p.items[0]))
                return false;
        }
        return true;
    }
    if ('object' === b.type) {
        const bEntries = Object.entries(b.properties);
        if (bEntries > Object.keys(p.properties).length)
            return false;
        for (const [ bKey, bVal ] of bEntries) {
            if (!isSubType(bVal, p.properties[bKey]))
                return false;
        }
        return true;
    }
    return true;
}

function combineTypes(a, b) {
    const out = { ...a, ...b };

    if (a.$ref) {
        if (a.$ref !== b.$ref)
            throw Error(`A $ref ${a.$ref} and B $ref ${b.$ref} do not match.`);
        return out;
    }
    if ('object' !== a.type)
        throw Error(`A type is not object: ${a.type}`);
    if ('object' !== b.type)
        throw Error(`B type is not object: ${b.type}`);

    out.properties = { ...a.properties, ...b.properties };
    out.required = intersect(a.required, b.required);

    {
        const sharedProps = intersect(Object.keys(a.properties), Object.keys(b.properties));
        for (const sharedProp of sharedProps) {
            aProp = a.properties[sharedProp];
            bProp = b.properties[sharedProp];
            if (isSubType(aProp, bProp)) {
                out.properties[sharedProp] = bProp;
            }
            else if (isSubType(bProp, aProp)) {
                out.properties[sharedProp] = aProp;
            }
            else
                throw Error(`Conflicting shared property when trying to combine objects: ${sharedProp}.`);
        }
    }

    return out;
}

const enumNames = {
    championId: 'champion',
    gameMode: 'gameMode',
    gameType: 'gameType',

    mapId: 'map',

    queueId: 'queue',

    teamId: 'team',
    killerTeamId: 'team',
};

function jsonToJsonSchema(input) {
    if (null === input) {
        throw Error('Cannot handle null.');
    }
    if (Array.isArray(input)) {
        const items = input.map(jsonToJsonSchema);
        return {
            type: 'array',
            items,
        };
    }
    if ('object' === typeof input) {
        const properties = {};
        for (const [ key, val ] of Object.entries(input)) {
            properties[key] = jsonToJsonSchema(val);
            if (enumNames[key]) {
                properties[key]['x-enum'] = enumNames[key];
            }
        }
        return {
            type: 'object',
            properties,
            required: Object.keys(input),
        };
    }
    if ('number' === typeof input) {
        if (0 === input % 1) {
            return {
                type: 'integer',
            };
        }
        return {
            type: 'number',
        };
    }
    if ('string' === typeof input) {
        return {
            type: 'string',
        };
    }
    if ('boolean' === typeof input) {
        return {
            type: 'boolean',
        };
    }
    throw Error(`Unexpected input: ${input}`);
}

function jsonSchemaToTypes(input, id, types = {}, typeNames = {}) {

    function helper(input, id, names) {
        if ('array' === input.type) {
            if (0 >= input.items.length) {
                console.warn('Input has empty array, cannot infer types.');
                return input;
            }

            for (let i = 0; i < input.items.length; i++) {
                input.items[i] = helper(input.items[i], id.endsWith('s') ? id.slice(0, -1) : id, names.concat([ i ]));
            }

            // Enforce type consolidation.
            const first = input.items[0];
            if (!input.items.slice(1).every(later => isSubType(later, first) && isSubType(first, later))) {
                console.error(input.items);
                throw Error('Failed to consolidate array');
            }
            input.items = first;

            return input;
        }
        if ('object' === input.type) {
            const hasNumericKeys = Object.keys(input.properties).every(key => /\d+/.test(key));
            const arrayItemId = id.endsWith('s') ? id.slice(0, -1) : id;
            for (const [ key, val ] of Object.entries(input.properties)) {
                input.properties[key] = helper(val, hasNumericKeys ? arrayItemId : `${id}${capitalize(key)}`, names.concat([ key ]));
            }

            // If this type already exists.
            for (const [ id, typeSpec ] of Object.entries(types)) {
                {
                    const typeNameArr = typeNames[id];

                    const pathMatches = typeNameArr.some(otherTypePath => {
                        if (otherTypePath.length !== names.length)
                            return false;
                        return otherTypePath.every((otherPathSeg, i) => {
                            const thisPathSeg = names[i];
                            if ('number' === typeof otherPathSeg && 'number' === typeof thisPathSeg)
                                return true;
                            return otherPathSeg === thisPathSeg;
                        });
                    });
                    // Only try subtyping if path matches.
                    if (pathMatches) {
                        // if (isSubType(input, typeSpec)) {
                        //     combineTypes(input, typeSpec);
                        // }
                        // else if (isSubType(typeSpec, input)) {
                        types[id] = combineTypes(typeSpec, input);
                        // }
                        // else {
                        //     // Not a sub type.
                        //     continue;
                        // }
                    }
                    else if (isSubType(input, typeSpec) && isSubType(typeSpec, input)) {
                        // Are the exact same type, combine them.
                    }
                    else {
                        // Not a sub type.
                        continue;
                    }
                }
                (typeNames[id] || (typeNames[id] = [])).push(names);
                return {
                    $ref: `#/components/schemas/${id}`,
                };
            }

            // This type does not already exist, set it.
            (typeNames[id] || (typeNames[id] = [])).push(names);
            types[id] = input;
            return {
                $ref: `#/components/schemas/${id}`,
            };
        }
        return input;
    }
    helper(input, id, [ id ]);

    return types;
}

function findExistingDtos(types, existingDtos) {
    function rename(oldName, newName) {
        const oldKey = `#/components/schemas/${oldName}`;
        const newKey = `#/components/schemas/${newName}`;
        function renameHelper(input) {
            if (!input)
                throw Error(`Invalid input: ${input}.`);

            if (input.$ref) {
                if (oldKey === input.$ref)
                    input.$ref = newKey;
            }
            else if ('array' === input.type) {
                if (Array.isArray(input.items))
                    input.items.forEach(renameHelper);
                else
                    renameHelper(input.items);
            }
            else if ('object' === input.type) {
                Object.values(input.properties).forEach(renameHelper);
            }
        }
        // Rename the type.
        const theType = types[oldName];
        delete types[oldName];
        types[newName] = theType;
        // Rename references.
        Object.values(types).forEach(renameHelper);
    }

    let changed;
    do {
        changed = false;
        for (const [ oldName, adHocType ] of Object.entries(types)) {
            for (const [ newName, existingType ] of Object.entries(existingDtos)) {
                if (newName === oldName)
                    continue;
                // TODO: only check the subtype in the first direction. BUT we need to pick the
                // best match if there are multiple matches.
                if (isSubType(adHocType, existingType) && isSubType(existingType, adHocType)) {
                    rename(oldName, newName);
                    changed = true;
                }
            }
        }
    } while (changed);
}

function main(id, ...inputNames) {
    const types = {};
    const typeNames = {};

    if (!inputNames || !inputNames.length) {
        console.error('Must supply inputName(s).');
        process.exit(1);
    }
    if (!id) {
        console.error('Must supply root ID.');
        process.exit(1);
    }
    console.log(inputNames);

    const util = require('util');
    const fs = require('fs');
    const writeFileAsync = util.promisify(fs.writeFile);

    for (const inputName of inputNames) {
        const json = require(`./${inputName}`);
        const jsonSchema = jsonToJsonSchema(json);
        // {
        //     const jsonSchemaStr = JSON.stringify(jsonSchema, null, 2);
        //     writeFileAsync(`./${inputName}-spec.json`, jsonSchemaStr);
        // }

        jsonSchemaToTypes(jsonSchema, id, types, typeNames);

        // findExistingDtos(types, require('../dtos'));
    }

    Object.keys(types).forEach(name => console.log(name));
    {
        const jsonTypesStr = JSON.stringify(types, null, 2);
        writeFileAsync(`./${id}-types.json`, jsonTypesStr);
    }
}

main(...process.argv.slice(2));
