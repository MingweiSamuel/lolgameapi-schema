function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

const boundariesRegex = /(?:\b|[_-]+|(?<=[a-z])(?=[A-Z])|(?=[A-Z][a-z]))/gm;
function camelCase(str) {
    return str.split(boundariesRegex)
        .map(capitalize)
        .join('');
}

// suB-type, suPer-type.
function isSubType(b, p) {
    if (b === p)
        return true;
    if (!p || !b)
        return false;

    if (b.type !== p.type)
        return false;
    if (b.$ref !== p.$ref)
        return false;

    if ('array' === b.type) {
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

function combineTypes(b, p) {
    // const out = { };

    if (b.type !== p.type)
        throw Error(`B type ${b.type} and P type ${p.type} do not match.`);
    if (b.$ref !== p.$ref)
        throw Error(`B $ref ${b.$ref} and P $ref ${p.$ref} do not match.`);

    if ('object' === p.type) {
        p.required = p.required.filter(x => b.required.includes(x));
    }
}

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

function jsonSchemaToTypes(input, name) {
    // const queue = [ input ];
    // const stack = [];

    // while (queue.length) {
    //     const item = queue.pop();
    //     stack.unshift(item);
    //     if ('array' === input.type) {
    //         queue.unshift(input.items);
    //     }
    // }

    let _id = 10000;
    function getId() {
        return '' + _id++;
    }

    const types = {};
    const typeNames = {};

    function helper(input, names) {
        if ('array' === input.type) {
            if (0 >= input.items.length) {
                console.warn('Input has empty array, cannot infer types.');
                return input;
            }

            for (let i = 0; i < input.items.length; i++) {
                input.items[i] = helper(input.items[i], names.concat([ i ]));
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
            for (const [ key, val ] of Object.entries(input.properties)) {
                input.properties[key] = helper(val, names.concat([ key ]));
            }

            // If this type already exists.
            for (const id of Object.keys(types)) {
                {
                    const typeSpec = types[id];
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
                        if (isSubType(input, typeSpec)) {
                            combineTypes(input, typeSpec);
                        }
                        else if (isSubType(typeSpec, input)) {
                            types[id] = combineTypes(typeSpec, input);
                        }
                        else {
                            // Not a sub type.
                            continue;
                        }
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
                    $ref: id,
                };
            }

            // This type does not already exist, set it.
            const id = getId();
            (typeNames[id] || (typeNames[id] = [])).push(names);
            types[id] = input;
            return {
                $ref: id,
            };
        }
        return input;
    }
    helper(input, [ name ]);

    const typeRenames = {};
    for (const [ id, namesArrays ] of Object.entries(typeNames)) {

    }
    for (const name of Object.keys(types)) {
        console.log(name, camelCase(name));
    }

    // return Object.keys(types).map(id => {
    //     return {
    //         names: typeNames[id],
    //         type: types[id],
    //     }
    // });
    return { types, typeNames };
}

const util = require('util');
const fs = require('fs');
const writeFileAsync = util.promisify(fs.writeFile);

const json = require('./allgamedata');
const jsonSchema = jsonToJsonSchema(json);
{
    const jsonSchemaStr = JSON.stringify(jsonSchema, null, 2);
    writeFileAsync('./allgamedata-spec.json', jsonSchemaStr);
}

const jsonTypes = jsonSchemaToTypes(jsonSchema, 'allGameData');
{
    const jsonTypesStr = JSON.stringify(jsonTypes, null, 2);
    writeFileAsync('./allgamedata-types.json', jsonTypesStr);
}
