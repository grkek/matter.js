/**
 * @license
 * Copyright 2022-2023 Project CHIP Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Logger } from "@project-chip/matter-node.js/log";
import { Argv } from "yargs";
import { MatterNode } from "../MatterNode";
import { setLogLevel } from "../app";

export default function commands(theNode: MatterNode) {
    return {
        command: "config",
        describe: "Manage global configuration",
        builder: (yargs: Argv) =>
            yargs
                // Console LogLevel
                .command("loglevel", "Manage Console and File LogLevels", yargs => {
                    return yargs
                        .command(
                            ["* [action]", "* [type] [ action]"],
                            "get/delete console or file log level",
                            yargs => {
                                return yargs
                                    .positional("type", {
                                        describe: "type to set the loglevel for",
                                        choices: ["console", "file"] as const,
                                        default: "console",
                                        type: "string",
                                    })
                                    .positional("action", {
                                        describe: "get/delete",
                                        choices: ["get", "delete"] as const,
                                        default: "get",
                                        type: "string",
                                    });
                            },
                            argv => void doLogLevel(theNode, argv),
                        )
                        .command(
                            "set <value>",
                            "set console log level",
                            yargs => {
                                return yargs
                                    .positional("type", {
                                        describe: "type to set the loglevel for",
                                        choices: ["console", "file"] as const,
                                        default: "console",
                                        type: "string",
                                    })
                                    .positional("value", {
                                        describe: "log level to set",
                                        type: "string",
                                        choices: ["fatal", "error", "warn", "info", "debug"] as const,
                                        demandOption: true,
                                    });
                            },
                            argv => void doLogLevel(theNode, { action: "set", ...argv }),
                        );
                })

                // LogFile name
                .command("logfile", "Manage Logfile path", yargs => {
                    return yargs
                        .command(
                            "* [action]",
                            "get/delete logfile path",
                            yargs => {
                                return yargs.positional("action", {
                                    describe: "get/delete",
                                    choices: ["get", "delete"] as const,
                                    default: "get",
                                    type: "string",
                                });
                            },
                            argv => void doLogfilePath(theNode, argv),
                        )
                        .command(
                            "set <value>",
                            "set logfile path",
                            yargs => {
                                return yargs.positional("value", {
                                    describe: "logfile path to set",
                                    type: "string",
                                    demandOption: true,
                                });
                            },
                            argv => void doLogfilePath(theNode, { action: "set", ...argv }),
                        );
                })

                // BLE HCI number (Linux)
                .command("ble-hci", "Manage BLE HCI ID (Linux)", yargs => {
                    return yargs
                        .command(
                            "* [action]",
                            "get/delete BLE HCI ID of the device (Linux only)",
                            yargs => {
                                return yargs.positional("action", {
                                    describe: "get/delete",
                                    choices: ["get", "delete"] as const,
                                    default: "get",
                                    type: "string",
                                });
                            },
                            argv => void doBleHci(theNode, argv),
                        )
                        .command(
                            "set <value>",
                            "set BLE HCI ID of the device (Linux only)",
                            yargs => {
                                return yargs.positional("value", {
                                    describe: "HCI ID to set",
                                    type: "number",
                                    demandOption: true,
                                });
                            },
                            argv => void doBleHci(theNode, { action: "set", ...argv }),
                        );
                })

                // Commissioning Wi-Fi credentials
                .command("wifi-credentials", "Manage Wi-Fi credentials used in commissioning process", yargs => {
                    return yargs
                        .command(
                            "* [action]",
                            "get/set Wi-Fi credentials",
                            yargs => {
                                return yargs.positional("action", {
                                    describe: "get/delete",
                                    choices: ["get", "delete"] as const,
                                    default: "get",
                                    type: "string",
                                });
                            },
                            argv => void doWifiCredentials(theNode, argv),
                        )
                        .command(
                            "set <wifi-ssid> <wifi-password>",
                            "set Wi-Fi credentials",
                            yargs => {
                                return yargs
                                    .positional("wifi-ssid", {
                                        describe: "SSID of the Wifi network to commission",
                                        type: "string",
                                        demandOption: true,
                                    })
                                    .positional("wifi-password", {
                                        describe: "Password of the Wifi network to commission",
                                        type: "string",
                                        demandOption: true,
                                    });
                            },
                            argv => void doWifiCredentials(theNode, { action: "set", ...argv }),
                        );
                })

                // Commissioning Thread credentials
                .command("thread-credentials", "Manage Thread credentials used in commissioning process", yargs => {
                    return yargs
                        .command(
                            "* [action]",
                            "get/set thread network credentials",
                            yargs => {
                                return yargs.positional("action", {
                                    describe: "get/delete",
                                    choices: ["get", "delete"] as const,
                                    default: "get",
                                    type: "string",
                                });
                            },
                            argv => void doThreadCredentials(theNode, argv),
                        )
                        .command(
                            "set <thread-name> <thread-operational-dataset>",
                            "set thread networkcredentials",
                            yargs => {
                                return yargs
                                    .positional("thread-name", {
                                        describe: "Thread network name to commission",
                                        type: "string",
                                        demandOption: true,
                                    })
                                    .positional("thread-operational-dataset", {
                                        describe: "Thread network operational dataset to commission",
                                        type: "string",
                                        demandOption: true,
                                    });
                            },
                            argv => void doThreadCredentials(theNode, { action: "set", ...argv }),
                        );
                }),
        handler: async (argv: any) => {
            argv.unhandled = true;
        },
    };
}

function doLogLevel(
    theNode: MatterNode,
    args: {
        action: string;
        type: string;
        value?: string;
    },
) {
    const { action, value } = args;
    const storageKey = args.type === "console" ? "LogLevel" : "LogLevelFile";
    const logtype = args.type === "console" ? "Console" : "File";
    switch (action) {
        case "get":
            console.log(`Current Loglevel for ${logtype}: ${theNode.Store.get<string>(storageKey, "info")}`);
            break;
        case "set":
            if (value === undefined) {
                console.log(`Can not change Loglevel for ${logtype}: New Loglevel value not provided`);
                return 1;
            }
            theNode.Store.set(storageKey, value);
            console.log(`New Loglevel for ${logtype}:" ${value}"`);
            setLogLevel(args.type === "console" ? "default" : "file", value);
            break;
        case "delete":
            theNode.Store.delete(storageKey);
            console.log(`Loglevel for ${logtype}: Reset to "info"`);
            setLogLevel(args.type === "console" ? "default" : "file", "info");
            break;
    }
    return 0;
}

function doLogfilePath(
    theNode: MatterNode,
    args: {
        action: string;
        value?: string;
    },
) {
    const { action, value } = args;
    switch (action) {
        case "get":
            console.log(`Current Logfile Path: ${theNode.Store.get<string>("LogFile", "-")}`);
            break;
        case "set":
            if (value === undefined) {
                console.log(`Can not change Logfile path: new path not provided`);
                return 1;
            }
            theNode.Store.set("LogFile", value);
            console.log(`New LogFile path:" ${value}". Please restart the shell for teh changes to take effect.`);
            break;
        case "delete":
            theNode.Store.delete("LogFile");
            console.log(`LogFile path removed. Please restart the shell for teh changes to take effect.`);
            break;
    }
    return 0;
}

function doBleHci(
    theNode: MatterNode,
    args: {
        action: string;
        value?: number;
    },
) {
    const { action, value } = args;
    switch (action) {
        case "get":
            console.log(`Current BLE HCI ID: ${theNode.Store.get<number>("BleHciId", 0)}`);
            break;
        case "set":
            if (value === undefined) {
                console.log(`Can not change HCI ID: New HCI ID value not provided`);
                return 1;
            }
            theNode.Store.set("BleHciId", value);
            console.log(`New HCI ID:" ${value}". Please restart the shell for teh changes to take effect.`);
            break;
        case "delete":
            theNode.Store.delete("BleHciId");
            console.log(`BLE HCI ID reset to default (0). Please restart the shell for teh changes to take effect.`);
            break;
    }
    return 0;
}

function doWifiCredentials(
    theNode: MatterNode,
    args: {
        action: string;
        wifiSsid?: string;
        wifiPassword?: string;
    },
) {
    const { action, wifiSsid, wifiPassword } = args;
    switch (action) {
        case "get":
            console.log(
                `Current Wifi-Credentials: SSID="${theNode.Store.get<string>(
                    "WiFiSsid",
                    "-",
                )}", Password="${Logger.maskString(theNode.Store.get<string>("WiFiPassword", ""))}"`,
            );
            break;
        case "set":
            if (wifiSsid === undefined || wifiPassword === undefined) {
                console.log(`Can not change Wi-Fi credentials: New values not provided`);
                return 1;
            }
            theNode.Store.set("WiFiSsid", wifiSsid);
            theNode.Store.set("WiFiPassword", wifiPassword);
            console.log(
                `New Wifi-Credentials: SSID="${theNode.Store.get<string>(
                    "WiFiSsid",
                    "-",
                )}", Password="${Logger.maskString(theNode.Store.get<string>("WiFiPassword"))}"`,
            );
            break;
        case "delete":
            theNode.Store.delete("WiFiSsid");
            theNode.Store.delete("WiFiPassword");
            console.log(`Wi-Fi credentials were deleted`);
            break;
    }
    return 0;
}

function doThreadCredentials(
    theNode: MatterNode,
    args: {
        action: string;
        threadName?: string;
        threadOperationalDataset?: string;
    },
) {
    const { action, threadName, threadOperationalDataset } = args;
    switch (action) {
        case "get":
            console.log(
                `Current Thread network credentials: name="${theNode.Store.get<string>(
                    "ThreadName",
                    "-",
                )}", Operational-Dataset="${Logger.maskString(
                    theNode.Store.get<string>("ThreadOperationalDataset", ""),
                )}"`,
            );
            break;
        case "set":
            if (threadName === undefined || threadOperationalDataset === undefined) {
                console.log(`Can not change Thread network credentials: New values not provided`);
                return 1;
            }
            theNode.Store.set("ThreadName", threadName);
            theNode.Store.set("ThreadOperationalDataset", threadOperationalDataset);
            console.log(
                `New Wifi-Credentials: SSID="${theNode.Store.get<string>(
                    "ThreadName",
                    "-",
                )}", OperationalDataset="${Logger.maskString(theNode.Store.get<string>("ThreadOperationalDataset"))}"`,
            );
            break;
        case "delete":
            theNode.Store.delete("ThreadName");
            theNode.Store.delete("ThreadOperationalDataset");
            console.log(`Thread network credentials were deleted`);
            break;
    }
    return 0;
}
