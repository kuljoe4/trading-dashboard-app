require('reflect-metadata');
const typeorm = require('typeorm');
if (typeorm && !typeorm.AbstractRepository) {
  typeorm.AbstractRepository = class AbstractRepository {};
}
