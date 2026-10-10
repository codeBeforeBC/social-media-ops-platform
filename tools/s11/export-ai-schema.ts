import {z} from 'zod';
import {topicCandidateSchema,topicOutputSchema} from '../../packages/domain/src/ai-workflows';
console.log(JSON.stringify({TopicCandidate:z.toJSONSchema(topicCandidateSchema),AITopicOutput:z.toJSONSchema(topicOutputSchema)}));
