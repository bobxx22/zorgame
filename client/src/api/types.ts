/**
 * Short names for the contract schemas. schema.gen.ts is generated from
 * api/part1.openapi.yaml by `npm run gen:api` and is never edited by hand.
 */
import type { components } from './schema.gen'

type Schemas = components['schemas']

export type Config = Schemas['Config']
export type Envelope = Schemas['Envelope']
export type ApiError = Schemas['Error']
export type EtherKey = Schemas['EtherKey']
export type Frame = Schemas['Frame']
export type Message = Schemas['Message']
export type News = Schemas['News']
export type Notice = Schemas['Notice']
export type Repository = Schemas['Repository']
export type RepositoryNotice = Schemas['RepositoryNotice']
export type RollEntry = Schemas['RollEntry']
export type Session = Schemas['Session']
export type Stage = Schemas['Stage']
export type StageSummary = Schemas['StageSummary']
export type Summary = Schemas['Summary']
export type User = Schemas['User']
