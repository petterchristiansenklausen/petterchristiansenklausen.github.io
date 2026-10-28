import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync, sign, createHash } from 'node:crypto';
import { verifyDeviceProof } from '../lib/billing/auth';

test('Apple device proof + P-256 signature binds a one-use challenge',()=>{
 const deviceVerificationID=randomUUID();
 const deviceVerificationNonce=randomUUID();
 const deviceVerification=createHash('sha384')
  .update(deviceVerificationNonce.toLowerCase()+deviceVerificationID.toLowerCase()).digest('base64');
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const jwk=keys.publicKey.export({format:'jwk'});
 assert.equal(jwk.crv,'P-256');
 const pub=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x!,'base64url'),Buffer.from(jwk.y!,'base64url')]);
 const challengeID=randomUUID(),nonce='one-time-secret';
 const signature=sign('sha256',Buffer.from(challengeID+':'+nonce),keys.privateKey);
 const body={deviceVerificationID,challengeID,devicePublicKey:pub.toString('base64'),deviceSignature:signature.toString('base64')};
 const apple={deviceVerificationNonce,deviceVerification};
 assert.doesNotThrow(()=>verifyDeviceProof(apple,body,nonce));
 assert.throws(()=>verifyDeviceProof(apple,{...body,deviceVerificationID:randomUUID()},nonce));
 assert.throws(()=>verifyDeviceProof(apple,{...body,deviceSignature:sign('sha256',Buffer.from('wrong-challenge'),keys.privateKey).toString('base64')},nonce));
 assert.throws(()=>verifyDeviceProof(apple,body,'different-nonce'));
 assert.throws(()=>verifyDeviceProof({...apple,deviceVerification:Buffer.alloc(48).toString('base64')},body,nonce));
});