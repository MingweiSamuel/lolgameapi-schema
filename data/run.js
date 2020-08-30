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

            // // If this type already exists in dtos.json.
            // for (const [ id, typeSpec ] of Object.entries(dtos)) {
            //     if (isSubType(input, typeSpec) && isSubType(typeSpec, input)) {
            //         return {
            //             $ref: `#/components/schemas/${id}`,
            //         };
            //     }
            // }

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
            const id = getId();
            (typeNames[id] || (typeNames[id] = [])).push(names);
            types[id] = input;
            return {
                $ref: `#/components/schemas/${id}`,
            };
        }
        return input;
    }
    helper(input, [ name ]);

    // const typeRenames = {};
    // for (const [ id, namesArrays ] of Object.entries(typeNames)) {

    // }
    // for (const name of Object.keys(types)) {
    //     console.log(name, camelCase(name));
    // }

    return types;
    // const out = {};
    // Object.keys(types).forEach(id => {
    //     const names = typeNames[id]
    //         .map(name => name
    //             .map(x => x.toString())
    //             .map(camelCase)
    //             .join(''));
    //     const name = names[0];
    //     // out[name] = {
    //     //     id,
    //     //     names,
    //     //     type: types[id]
    //     // };
    //     out[id + name] = types[id];
    // });
    // return out;
    // return Object.keys(types).map(id => {
    //     return {
    //         names: typeNames[id],
    //         type: types[id],
    //     }
    // });
    // return { types, typeNames };
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

function main(inputName) {
    if (!inputName) {
        console.error('Must supply inputName.');
        process.exit(1);
    }
    const util = require('util');
    const fs = require('fs');
    const writeFileAsync = util.promisify(fs.writeFile);

    const dtos = require('../dtos');

    const json = require(`./${inputName}`);
    const jsonSchema = jsonToJsonSchema(json);
    {
        const jsonSchemaStr = JSON.stringify(jsonSchema, null, 2);
        writeFileAsync(`./${inputName}-spec.json`, jsonSchemaStr);
    }

    const jsonTypes = jsonSchemaToTypes(jsonSchema, inputName);
    findExistingDtos(jsonTypes, dtos);
    Object.keys(jsonTypes).forEach(name => console.log(name));
    {
        const jsonTypesStr = JSON.stringify(jsonTypes, null, 2);
        writeFileAsync(`./${inputName}-types.json`, jsonTypesStr);
    }
}

main(process.argv[2]);
