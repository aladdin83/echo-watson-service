import { Controller, Param, Body, Query, Get, Post, Logger } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { WatsonService } from '../watson/watson.service';
import { GotItService } from '../gotit/got-it.service';

@Controller('api/webhooks')
export class WebhooksController {

    constructor(
        private projectsService: ProjectsService,
        private gotItService: GotItService,
    ) {}

    @Post(':projectId/watson')
    async request(@Param('projectId') projectId: string, @Param('service') service: string, @Body() requestBody: any, @Query() queryParams: any) {
        const project = await this.projectsService.findById(projectId);
        const watsonService = new WatsonService(project.serviceProvider);
        const gotItReqBody = watsonService.formatRequest(requestBody);
        Logger.debug(requestBody);
        return this.gotItService.fulfillment(gotItReqBody);
    }

}
