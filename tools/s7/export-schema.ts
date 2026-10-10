import {z} from 'zod';
import {metricSchema,templateFields,metricDefinitions} from '../../packages/domain/src/imports';
console.log(JSON.stringify({metric:z.toJSONSchema(metricSchema),fields:templateFields,definitions:metricDefinitions}));
