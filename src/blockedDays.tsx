import Q = require("q");

import TFS_Wit_Contracts = require("TFS/WorkItemTracking/Contracts");

import TFS_Wit_Client = require("TFS/WorkItemTracking/RestClient");
import TFS_Wit_Services = require("TFS/WorkItemTracking/Services");


const ChildWorkItemTypeField = 'Impediment';
const ImpedimentStartDateField = 'Custom.StartBlockedDay';
const ImpedimentFinishDateField = 'Custom.FinishBlockedDay';
const BlockedDaysField = 'Custom.BlockedDays';


function getWorkItemFormService()
{
    return TFS_Wit_Services.WorkItemFormService.getService();
}

function getWorkItemClient(){
    return TFS_Wit_Client.getClient();
}

var getConvertDate = (value) => {

    if (value === undefined) return new Date();
    
    return new Date(value);
}

var getDifferenceInDays = (startDate: Date, finishDate: Date) => {
    //Get 1 day in milliseconds
    var one_day=1000*60*60*24;

    // Convert both dates to milliseconds
    var date1_ms = startDate.getTime();
    var date2_ms = finishDate.getTime();

    // Calculate the difference in milliseconds
    var difference_ms = date2_ms - date1_ms;

    // Convert back to days and return
    return Math.floor(difference_ms/one_day) + 1;
}

function getBlockedDaysFromImpedimentWI(workItemId) {
    var client = getWorkItemClient();
    var deferred = Q.defer();

    client.getWorkItem(workItemId).then( 
        function(workItem) {
            var workItemType = workItem.fields['System.WorkItemType'] ;

            if (workItemType === ChildWorkItemTypeField) {
                var startDate = getConvertDate(workItem.fields[ImpedimentStartDateField]);
                var finishDate = getConvertDate(workItem.fields[ImpedimentFinishDateField]);
                var blockedDays = getDifferenceInDays(startDate, finishDate);

                deferred.resolve(blockedDays)
            }
            else{
                deferred.resolve(0);
            }
        }, 
        function(error){
            console.error(error);
            deferred.reject(0)
        });

    return deferred.promise;
}

var processRelatedWI = (workItemRelated: TFS_Wit_Contracts.WorkItemRelation) => {
    var deferred = Q.defer();

    var lastPosition = workItemRelated.url.lastIndexOf('/') + 1;
    var workItemId = workItemRelated.url.substr(lastPosition);

    getBlockedDaysFromImpedimentWI(workItemId).then(
        function(blockedDays: number) {
            deferred.resolve(blockedDays); 
        },
        function(error) {
            console.error(error);
            deferred.reject(0);
    });

    return deferred.promise;
}

var updateBlockedDaysFromGrid = (workItemId) => {
    var deferred = Q.defer();
    var client = getWorkItemClient();

    client.getWorkItem(workItemId, null, null, TFS_Wit_Contracts.WorkItemExpand.All).then((workItem: TFS_Wit_Contracts.WorkItem) => {

        if (workItem.fields[BlockedDaysField] !== undefined) { 

            var actions = workItem.relations.map(processRelatedWI);
            var results = Q.all(actions); // pass array of promises
            
            results.then(data => {

                var workItemBlockedDays = data.reduce((a: number, b: number) => a + b, 0)

                var document = [{
                    from: null,
                    op: "add",
                    path: '/fields/' + BlockedDaysField,
                    value: workItemBlockedDays
                }];
    
                if (workItemBlockedDays != workItem.fields[BlockedDaysField]) {
                    client.updateWorkItem(document, workItemId).then((updatedWorkItem:TFS_Wit_Contracts.WorkItem) => {
                        deferred.resolve(updatedWorkItem);
                    });
                }
            });
        }
        else
            console.log(`It is not possible to refresh 'Blocked Days' to work item that not exist ${BlockedDaysField}.`)
    });

    return deferred.promise;

}

var updateBlockedDaysFromForm = () => {
    var deferred = Q.defer();

    getWorkItemFormService().then((service) => {
        service.getFieldValues(['System.WorkItemType', BlockedDaysField]).then(
            (fields) => {
                var workItemType = fields['System.WorkItemType'];

                if (fields[BlockedDaysField] !== undefined){
                    service.getWorkItemRelations().then(
                        (workItensRelated) => {

                            var actions = workItensRelated.map(processRelatedWI);
                            var results = Q.all(actions); // pass array of promises
                        
                            results.then(data => {
                                var workItemBlockedDays = data.reduce((a: number, b: number) => a + b, 0)
                                service.setFieldValue(BlockedDaysField, workItemBlockedDays);

                                deferred.resolve(true);
                            },
                            error => {
                                console.error(error);
                                deferred.reject(false);
                            });                
                        },
                        (error) => {
                            console.error(error);
                            deferred.reject(false);
                        }
                    )
                }
            },
            function(error){
                console.error(error);
                deferred.reject(false);
            });
    });

    return deferred.promise;
}

var formObserver = (context) => {

    return {
        onLoaded: function(args) { 
            updateBlockedDaysFromForm().then(() => {
                console.log('(onLoaded) Success refresh  blocked days')
            })
        },
        onSaved : function(args) { 
            updateBlockedDaysFromForm().then(() => {
                console.log('(onSaved) Success refresh  blocked days')
            })
        }
    };
}

var contextProvider = (context) => {
    return {
        execute: function (actionContext) {

            var workItemIds = actionContext.workItemIds;
            var promises = [];
            $.each(workItemIds, function(index, workItemId) {
                promises.push(updateBlockedDaysFromGrid(workItemId));
            });

            // Refresh view
            Q.all(promises).then(() => {
                VSS.getService(VSS.ServiceIds.Navigation).then((navigationService: IHostNavigationService) => {
                    navigationService.reload();
                });
            });
        }

    };
}

let extensionContext = VSS.getExtensionContext();
VSS.register(`${extensionContext.publisherId}.${extensionContext.extensionId}.blocked-days-work-item-form-observer`, formObserver);
VSS.register(`${extensionContext.publisherId}.${extensionContext.extensionId}.blocked-days-contextMenu`, contextProvider);
