import { MatterDevice } from "../../../MatterDevice.js";
import type { Message } from "../../../codec/MessageCodec.js";
import { assertSecureSession } from "../../../session/SecureSession.js";
import { Session } from "../../../session/Session.js";
import { ActionContext } from "./ActionContext.js";
import { Transaction } from "../../state/transaction/Transaction.js";
import { ContextAgents } from "./ContextAgents.js";
import { Agent } from "../../../endpoint/Agent.js";
import { EndpointType } from "../../../endpoint/type/EndpointType.js";
import { Part } from "../../../endpoint/Part.js";
import { AccessControl } from "../../AccessControl.js";
import { AccessLevel } from "../../../cluster/Cluster.js";
import { ImplementationError } from "../../../common/MatterError.js";
import { FabricIndex } from "../../../datatype/FabricIndex.js";
import { SubjectId } from "../../../datatype/SubjectId.js";
import { MaybePromise } from "../../../util/Promises.js";
import { Diagnostic } from "../../../log/Diagnostic.js";
import { Contextual } from "./Contextual.js";

/**
 * Operate in online context.  Public Matter API interactions happen in online context.
 */
export function OnlineContext(options: OnlineContext.Options) {
    return {
        act<T>(actor: (context: ActionContext) => MaybePromise<T>): MaybePromise<T> {
            let agents: undefined | ContextAgents;

            let fabric: FabricIndex;
            let subject: SubjectId;
            
            const session = options.session;
            if (session) {
                assertSecureSession(session);
                fabric = options.session.getAssociatedFabric().fabricIndex;
        
                // TODO - group subject
                subject = options.session.getPeerNodeId() as SubjectId;
            } else {
                fabric = options.fabric;
                subject = options.subject;
            }
        
            if (fabric === undefined) {
                throw new ImplementationError("OnlineContxt requires an authorized fabric");
            }
            if (subject === undefined) {
                throw new ImplementationError("OnlineContext requires an authorizied subject");
            }
        
            let via;
            const message = options.message;
            via = Diagnostic.via(`online#${
                message?.packetHeader.messageId.toString(16) ?? "?"
            }:${
                options.subject?.toString(16) ?? "?"
            }`);
        
            return Transaction.act(via, transaction => {
                const context = {
                    ...options,
                    session,
                    subject,
                    fabric,
                    transaction,
        
                    accessLevelFor(_location?: AccessControl.Location) {
                        // TODO - use AccessControlServer on the RootNodeEndpoint
                        //const accessControl = accessContext.behavior.node.get(AccessControlServer);
                        //return accessControl.accessLevelFor((context as ActionContext), accessContext);
                        return AccessLevel.Administer;
                    },
        
                    agentFor<T extends EndpointType>(part: Part<T>): Agent.Instance<T> {
                        if (!agents) {
                            agents = ContextAgents(context as ActionContext);
                        }
                        return agents.agentFor(part);
                    },

                    get [Contextual.context](): ActionContext {
                        return this;
                    }
                };
        
                if (message) {
                    Contextual.setContextOf(message, context);
                }

                try {
                    return actor(context);
                } finally {
                    if (message) {
                        Contextual.setContextOf(message, undefined);
                    }
                }
            });
        }
    }
}

export namespace OnlineContext {
    export type Options =
        & {
            command?: boolean;
            fabricFiltered?: boolean;
            message?: Message;
        }
        & (
            | { session: Session<MatterDevice>, fabric?: undefined, subject?: undefined }
            | { session?: undefined, fabric: FabricIndex, subject: SubjectId }
        );
}
