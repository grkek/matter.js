/**
 * @license
 * Copyright 2022-2023 Project CHIP Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { SupportedAttributeClient, UnknownSupportedAttributeClient } from "../cluster/client/AttributeClient.js";
import { ClusterClientObj } from "../cluster/client/ClusterClientTypes.js";
import { SupportedEventClient, UnknownSupportedEventClient } from "../cluster/client/EventClient.js";
import { GlobalAttributes } from "../cluster/Cluster.js";
import { AnyAttributeServer, FabricScopeError } from "../cluster/server/AttributeServer.js";
import { asClusterServerInternal, ClusterServerObj } from "../cluster/server/ClusterServerTypes.js";
import { Endpoint } from "../device/Endpoint.js";
import { Logger } from "../log/Logger.js";
import { toHexString } from "../util/Number.js";

const logger = Logger.get("EndpointStructureLogger");

/**
 * Options for logging endpoint structure. The default is that anything is logged beside "Non Supported" attributes and
 * events on ClusterClients. The Filter methods can be used to filter out specific endpoints or clusters if wanted.
 */
export type EndpointLoggingOptions = {
    logClusterServers?: boolean;
    logClusterClients?: boolean;
    logChildEndpoints?: boolean;
    logClusterGlobalAttributes?: boolean;
    logClusterAttributes?: boolean;
    logNotSupportedClusterAttributes?: boolean;
    logClusterCommands?: boolean;
    logClusterEvents?: boolean;
    logNotSupportedClusterEvents?: boolean;
    logNotSupportedClusterCommands?: boolean;
    logAttributePrimitiveValues?: boolean;
    logAttributeObjectValues?: boolean;

    clusterServerFilter?: (endpoint: Endpoint, cluster: ClusterServerObj<any, any>) => boolean;
    clusterClientFilter?: (endpoint: Endpoint, cluster: ClusterClientObj<any, any, any, any>) => boolean;
    endpointFilter?: (endpoint: Endpoint) => boolean;
};

function getAttributeServerValue(attribute: AnyAttributeServer<any>, options: EndpointLoggingOptions = {}) {
    let value = "";
    try {
        const attributeValue = attribute.getLocal();
        const attributeValueType = typeof attributeValue;
        if (
            (attributeValueType !== "object" || attributeValue === null) &&
            options.logAttributePrimitiveValues !== false
        ) {
            value = attributeValue === null ? "null" : attributeValue.toString();
        } else if (
            attributeValueType === "object" &&
            attributeValue !== null &&
            options.logAttributeObjectValues !== false
        ) {
            value = Logger.toJSON(attributeValue);
        }
    } catch (error) {
        if (error instanceof FabricScopeError) {
            value = "Fabric-Scoped";
        } else {
            value = `Error: ${(error as any).message}`;
        }
    }
    return value;
}

function logClusterServer(
    endpoint: Endpoint,
    clusterServer: ClusterServerObj<any, any>,
    options: EndpointLoggingOptions = {},
) {
    if (options.clusterServerFilter !== undefined && !options.clusterServerFilter(endpoint, clusterServer)) return;

    const featureMap = clusterServer.attributes.featureMap?.getLocal() ?? {};
    const globalAttributes = GlobalAttributes<any>(featureMap);
    const supportedFeatures = new Array<string>();
    for (const featureName in featureMap) {
        if ((featureMap as any)[featureName] === true) supportedFeatures.push(featureName);
    }
    logger.info(
        `Cluster-Server "${clusterServer.name}" (${toHexString(clusterServer.id)}) ${
            supportedFeatures.length ? `(Features: ${supportedFeatures.join(", ")})` : ""
        }`,
    );
    if (options.logClusterGlobalAttributes !== false) {
        Logger.nest(() => {
            logger.info("Global-Attributes:");
            Logger.nest(() => {
                for (const attributeName in globalAttributes) {
                    const attribute = clusterServer.attributes[attributeName];
                    if (attribute === undefined) continue;

                    const value = getAttributeServerValue(attribute, options);
                    logger.info(
                        `"${attribute.name}" (${toHexString(attribute.id)})${value !== "" ? `: value = ${value}` : ""}`,
                    );
                }
            });
        });
    }
    if (options.logClusterAttributes !== false) {
        Logger.nest(() => {
            logger.info("Attributes:");
            Logger.nest(() => {
                for (const attributeName in clusterServer.attributes) {
                    if (attributeName in globalAttributes) continue;
                    const attribute = clusterServer.attributes[attributeName];
                    if (attribute === undefined) continue;

                    const value = getAttributeServerValue(attribute, options);
                    logger.info(
                        `"${attribute.name}" (${toHexString(attribute.id)})${value !== "" ? `: value = ${value}` : ""}`,
                    );
                }
            });
        });
    }
    if (options.logClusterCommands !== false) {
        Logger.nest(() => {
            logger.info("Commands:");
            Logger.nest(() => {
                const commands = asClusterServerInternal(clusterServer)._commands;
                for (const commandName in commands) {
                    const command = commands[commandName];
                    if (command === undefined) continue;
                    logger.info(`"${command.name}" (${toHexString(command.invokeId)}/${command.responseId})`);
                }
            });
        });
    }
    if (options.logClusterEvents !== false) {
        Logger.nest(() => {
            logger.info("Events:");
            Logger.nest(() => {
                const events = asClusterServerInternal(clusterServer)._events;
                for (const eventName in events) {
                    const event = events[eventName];
                    if (event === undefined) continue;
                    logger.info(`"${event.name}" (${toHexString(event.id)})`);
                }
            });
        });
    }
}

function logClusterClient(
    endpoint: Endpoint,
    clusterClient: ClusterClientObj<any, any, any, any>,
    options: EndpointLoggingOptions = {},
) {
    if (options.clusterClientFilter !== undefined && !options.clusterClientFilter(endpoint, clusterClient)) return;

    const { supportedFeatures: features } = clusterClient;
    const globalAttributes = GlobalAttributes<any>(features);
    const supportedFeatures = new Array<string>();
    for (const featureName in features) {
        if (features[featureName] === true) supportedFeatures.push(featureName);
    }

    logger.info(
        `Cluster-Client "${clusterClient.name}" (${toHexString(clusterClient.id)}) ${
            supportedFeatures.length ? `(Features: ${supportedFeatures.join(", ")})` : ""
        }`,
    );
    if (options.logClusterGlobalAttributes !== false) {
        Logger.nest(() => {
            logger.info("Global-Attributes:");
            Logger.nest(() => {
                for (const attributeName in globalAttributes) {
                    const attribute = clusterClient.attributes[attributeName];
                    if (attribute === undefined) continue;

                    logger.info(`"${attribute.name}" (${toHexString(attribute.id)})`);
                }
            });
        });
    }
    if (options.logClusterAttributes !== false) {
        Logger.nest(() => {
            logger.info("Attributes:");
            Logger.nest(() => {
                for (const attributeName in clusterClient.attributes) {
                    if (attributeName in globalAttributes) continue;
                    const attribute = clusterClient.attributes[attributeName];
                    if (attribute === undefined) continue;
                    const supported = attribute instanceof SupportedAttributeClient;
                    if (!supported && options.logNotSupportedClusterAttributes === false) continue;
                    const unknown = attribute instanceof UnknownSupportedAttributeClient;

                    let info = "";
                    if (!supported) info += " (Not Supported)";
                    if (unknown) info += " (Unknown)";

                    logger.info(`"${attribute.name}" (${toHexString(attribute.id)})${info}`);
                }
            });
        });
    }
    if (options.logClusterCommands !== false) {
        Logger.nest(() => {
            logger.info("Commands:");
            Logger.nest(() => {
                for (const commandName in clusterClient.commands) {
                    const supported = clusterClient.isCommandSupportedByName(commandName);
                    if (!supported && options.logNotSupportedClusterCommands === false) continue;
                    logger.info(`"${commandName}"${supported ? "" : " (Not Supported)"}`);
                }
            });
        });
    }
    if (options.logClusterEvents !== false) {
        Logger.nest(() => {
            logger.info("Events:");
            Logger.nest(() => {
                for (const eventName in clusterClient.events) {
                    const event = clusterClient.events[eventName];
                    if (event === undefined) continue;
                    const supported = event instanceof SupportedEventClient;
                    if (!supported && options.logNotSupportedClusterEvents === false) continue;
                    const unknown = event instanceof UnknownSupportedEventClient;

                    let info = "";
                    if (!supported) info += " (Not Supported)";
                    if (unknown) info += " (Unknown)";

                    logger.info(`"${event.name}" (${toHexString(event.id)})${info}`);
                }
            });
        });
    }
}

export function logEndpoint(
    endpoint: Endpoint,
    options: EndpointLoggingOptions = {
        logNotSupportedClusterAttributes: false,
        logNotSupportedClusterEvents: false,
        logNotSupportedClusterCommands: false,
    },
) {
    if (options.endpointFilter !== undefined && !options.endpointFilter(endpoint)) return;

    logger.info(`Endpoint ${endpoint.id} (${endpoint.name}):`);
    if (options.logClusterServers !== false) {
        Logger.nest(() => {
            logger.info("Cluster-Servers:");
            Logger.nest(() => {
                for (const clusterServer of endpoint.getAllClusterServers()) {
                    logClusterServer(endpoint, clusterServer, options);
                }
            });
        });
    }
    if (options.logClusterClients !== false) {
        Logger.nest(() => {
            logger.info("Cluster-Clients:");
            Logger.nest(() => {
                for (const clusterClient of endpoint.getAllClusterClients()) {
                    logClusterClient(endpoint, clusterClient, options);
                }
            });
        });
    }
    if (options.logChildEndpoints !== false) {
        Logger.nest(() => {
            logger.info("Child-Endpoints:");
            Logger.nest(() => {
                for (const childEndpoint of endpoint.getChildEndpoints()) {
                    logEndpoint(childEndpoint, options);
                }
            });
        });
    }
}
