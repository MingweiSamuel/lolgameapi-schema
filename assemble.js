const util = require('util');
const fs = require('fs');
const writeFileAsync = util.promisify(fs.writeFile);

const dtos = require('./dtos');
const returnTypes = require('./returnTypes');
const openapi = require('./openapi');

openapi.components.schemas = dtos;
openapi.paths = Object.fromEntries(Object.entries(openapi.paths)
    .filter(([ path, pathInfo ]) => {
        const returnType = returnTypes[path];
        if (undefined === returnType) return false;
        pathInfo['x-endpoint'] = 'LiveClientData'; // TODO if there's more than one.
        if (null !== returnType)
            pathInfo.get.responses['200'].content['application/json'].schema = returnType;
        return true;
    }));
openapi.info.description = 'League of Legends game client Live Client Data API';
openapi.info.title = 'LoL Live Client Data'

writeFileAsync('./openapi-lcd.json', JSON.stringify(openapi, null, 2));
