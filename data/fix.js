// Basic script to fix broken LiveClientData schema.
for (const pathInfo of Object.values(x.paths)) {
    for (const pathVerb of Object.values(pathInfo)) {
        for (const paramInfo of pathVerb.parameters) {
            paramInfo.schema = { type: paramInfo.type, enum: paramInfo.enum, format: paramInfo.format };
            delete paramInfo.type;
            delete paramInfo.enum;
            delete paramInfo.format;
        }
    }
}
console.log(JSON.stringify(x, null, 2));
