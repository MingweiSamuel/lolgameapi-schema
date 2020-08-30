const util = require('util');
const fs = require('fs');
const writeFileAsync = util.promisify(fs.writeFile);

const dtos = require('./dtos');
const extraData = require('./extraData');
const openapi = require('./openapi');

openapi.components.schemas = dtos;
openapi.paths = Object.fromEntries(Object.entries(openapi.paths)
    .filter(([ path, pathInfo ]) => {
        const extraDatum = extraData[path];
        if (undefined === extraDatum) return false;
        // TODO handle endpoints properly.
        pathInfo['x-endpoint'] = 'LiveClientData';
        pathInfo.get.operationId = 'LiveClientData.get' + extraDatum.name;
        if (extraDatum.retval)
            pathInfo.get.responses['200'].content['application/json'].schema = extraDatum.retval;
        return true;
    }));
openapi.info.description = 'League of Legends game client Live Client Data API';
openapi.info.title = 'LoL Live Client Data'

writeFileAsync('./openapi-lcd.json', JSON.stringify(openapi, null, 2));
