import { describe, expect, it, vi } from 'vitest';
import { classifyServiceError, retryD1Read } from '../resilience';
describe('service resilience',()=>{
 it('retries a verified transient read and returns the literal value without duplicating success',async()=>{let calls=0;const value=await retryD1Read(async()=>{calls++;if(calls<3)throw Error('D1 database is busy');return 'row'});expect(value).toBe('row');expect(calls).toBe(3)});
 it('does not retry permanent schema errors',async()=>{let calls=0;await expect(retryD1Read(async()=>{calls++;throw Error('no such table: sessions')})).rejects.toThrow('no such table');expect(calls).toBe(1)});
 it('maps transient D1 and schema failures to truthful non-secret errors',()=>{expect(classifyServiceError(Error('D1 database is locked'))).toMatchObject({code:'database_temporarily_unavailable',status:503,retryable:true,message:'Database temporarily unavailable'});expect(classifyServiceError(Error('no such column: x'))).toMatchObject({code:'database_schema_not_ready',status:503,retryable:false,message:'Database schema not ready'})});
});
