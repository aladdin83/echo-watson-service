import { Injectable } from '@angular/core';
import { ApiService } from '../../core/common/api.service';
import { Project } from './project.interface';
import { CreateProjectDto } from './create-project.dto';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { CustomEntity } from './entity.interface';
import { Intent, UtterancePart, IntentParam } from './intent.interface';
import { isNullOrUndefined } from 'util';
import { WatsonPublishingJob } from '../watson/watson-publish/watson-publishing-job.interface';

@Injectable()
export class ProjectsService extends ApiService<Project, CreateProjectDto> {
    apiPath = `${environment.apiRoot}/api/projects`;

    constructor(
        protected http: HttpClient,
    ) {super(); }

    publish(project: Project, publishingJob: WatsonPublishingJob | any) {
        return this.http.post(`${this.apiPath}/${project.id}/publish`, publishingJob);
    }

    parseEntities(project: Project): CustomEntity[] {
        if (!project.originalSchema) {throw new Error('Project schema is undefined'); }
        if (!project.originalSchema.custom_entities) {return null; }
        return Object.keys(project.originalSchema.custom_entities).map((entityId: string) => {
            const originalEntity: any = project.originalSchema.custom_entities[entityId];
            return {
                id: entityId,
                index: originalEntity.index,
                entityType: originalEntity.entity_type,
                table: originalEntity.table,
                column: originalEntity.column,
                dictionary: originalEntity.dictionary,
                regexp: originalEntity.regexp || false,
                fuzzyMatching: originalEntity.fuzzyMatching || false,
            };
        });
    }

    parseIntents(project: Project): Intent[] {
        if (!project.originalSchema) {throw new Error('Project schema is undefined'); }
        if (!project.originalSchema.custom_entities) {return null; }
        return project.originalSchema.intents.map((originalIntent: any) => {
            return {
                id: originalIntent.id as string,
                utterances: (originalIntent.utterances as Array<any>).map((utterance) => {
                    return {parts: utterance.parts.map((part: any) => {
                        return {
                            text: part.text,
                            alias: part.alias || null,
                            entityType: part.entity_type || null
                        } as UtterancePart;
                    })};
                }),
                followupUtterances: originalIntent.followup_utterances,
                responseTemplates: Array(originalIntent.response_template),
                parameters: (originalIntent.parameters as Array<any>).map((param) => {
                    return {
                        id: param.id,
                        mandatory: param.mandatory,
                        entityType: param.entity_type,
                        friendlyName: param.friendly_name
                    } as IntentParam;
                }),
            } as Intent;
        });
    }
}
