/** S1 wire types. Runtime shapes are validated against contracts/openapi.json in HTTP tests. */
export type Role='admin'|'editor'|'operator'|'viewer';
export type JobState='queued'|'running'|'succeeded'|'partial'|'failed'|'cancelled';
export interface Meta {request_id:string;server_time:string}
export interface Envelope<T> {data:T;meta:Meta}
export interface ErrorEnvelope {error:{code:string;message:string;field_errors:Record<string,unknown>;retryable:boolean;request_id:string}}
export interface Page<T> {items:T[];next_cursor:string|null}
export interface SessionData {
  user:{id:string;email:string;display_name:string};
  membership:{id:string;workspace_id:string;roles:Role[]};
  workspace:{id:string;name:string;timezone:string;settings:Record<string,unknown>;version:number;created_at:string;updated_at:string};
  permissions:string[];expires_at:string;
}
export interface JobSummary {id:string;workspace_id:string;type:string;pool:'general'|'media';state:JobState;attempts:number;input_version:number|null;error_code:string|null;request_id:string;created_at:string;version:number}

export interface TopicAccepted {decision_id:string;topic_id:string;status:'accepted';version:number}
export type FilePurpose='import_screenshot'|'import_table'|'source_evidence';
export interface Publication {id:string;account_id:string;platform_note_id:string;url:string;title:string|null;media_type:'graphic'|'video'|null;published_at:string;traffic_type:'organic'|'paid'|'mixed'|'unknown';lifecycle:'active'|'deleted';version:number}
