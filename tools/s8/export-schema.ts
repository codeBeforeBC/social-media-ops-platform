import {z} from 'zod';
import {reportOutputSchema} from '../../packages/domain/src/reports';
import {feedbackOutputSchema} from '../../packages/domain/src/feedback';
import {sourceOrganizationSchema} from '../../packages/domain/src/source-organization';
console.log(JSON.stringify(z.toJSONSchema(process.argv[2]==='sources'?sourceOrganizationSchema:process.argv[2]==='feedback'?feedbackOutputSchema:reportOutputSchema)));
