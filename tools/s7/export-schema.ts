import {z} from 'zod';
import {metricSchema,templateFields,metricDefinitions} from '../../packages/domain/src/imports';
import {sourceRegionSchema} from '../../packages/domain/src/screenshot-imports';
console.log(JSON.stringify({metric:z.toJSONSchema(metricSchema),source_region:z.toJSONSchema(sourceRegionSchema),fields:templateFields,definitions:metricDefinitions}));
