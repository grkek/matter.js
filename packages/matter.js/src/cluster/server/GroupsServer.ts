/**
 * @license
 * Copyright 2022 The node-matter Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { GroupId } from "../../datatype/GroupId.js";
import { Fabric } from "../../fabric/Fabric.js";
import { StatusCode } from "../../protocol/interaction/StatusCode.js";
import { assertSecureSession } from "../../session/SecureSession.js";
import { GroupsCluster } from "../definitions/GroupsCluster.js";
import { IdentifyCluster } from "../definitions/IdentifyCluster.js";
import { ClusterServer } from "./ClusterServer.js";
import { ClusterServerHandlers } from "./ClusterServerTypes.js";
import { ScenesManager } from "./ScenesServer.js";

/*
TODO: If the Scenes server cluster is implemented on the same endpoint, the following extension field SHALL
      be added to the Scene Table:
      * OnOff
 */

export class GroupsManager {
    static setGroup(fabric: Fabric, endpointId: number, groupId: GroupId, groupName: string) {
        let endpointGroups = fabric.getScopedClusterDataValue<Map<GroupId, string>>(
            GroupsCluster,
            endpointId.toString(),
        );
        if (endpointGroups === undefined) {
            endpointGroups = new Map<GroupId, string>();
        }
        endpointGroups.set(groupId, groupName || "");

        fabric.setScopedClusterDataValue(GroupsCluster, endpointId.toString(), endpointGroups);
    }

    static getGroupName(fabric: Fabric, endpointId: number, groupId: GroupId): string | undefined {
        const endpointGroups = fabric.getScopedClusterDataValue<Map<GroupId, string>>(
            GroupsCluster,
            endpointId.toString(),
        );
        return endpointGroups?.get(groupId);
    }

    static hasGroup(fabric: Fabric, endpointId: number, groupId: GroupId): boolean {
        const endpointGroups = fabric.getScopedClusterDataValue<Map<GroupId, string>>(
            GroupsCluster,
            endpointId.toString(),
        );
        return endpointGroups?.has(groupId) ?? false;
    }

    static getGroups(fabric: Fabric, endpointId: number): Map<GroupId, string> {
        return (
            fabric.getScopedClusterDataValue<Map<GroupId, string>>(GroupsCluster, endpointId.toString()) ??
            new Map<GroupId, string>()
        );
    }

    static removeGroup(fabric: Fabric, endpointId: number, groupId: GroupId): boolean {
        const endpointGroups = fabric.getScopedClusterDataValue<Map<GroupId, string>>(
            GroupsCluster,
            endpointId.toString(),
        );
        if (endpointGroups !== undefined) {
            if (endpointGroups.delete(groupId)) {
                fabric.persist(); // persist scoped cluster data changes
                return true;
            }
        }
        return false;
    }

    static removeAllGroups(fabric: Fabric, endpointId: number) {
        fabric.deleteScopedClusterDataValue(GroupsCluster, endpointId.toString());
    }
}

export const GroupsClusterHandler: () => ClusterServerHandlers<typeof GroupsCluster> = () => {
    const addGroupLogic = (groupId: GroupId, groupName: string, fabric: Fabric, endpointId: number) => {
        if (groupId < 1) {
            return { status: StatusCode.ConstraintError, groupId };
        }
        if (groupName.length > 16) {
            return { status: StatusCode.ConstraintError, groupId };
        }

        GroupsManager.setGroup(fabric, endpointId, groupId, groupName);

        return { status: StatusCode.Success, groupId };
    };

    return {
        addGroup: async ({ request: { groupId, groupName }, session, endpoint }) => {
            assertSecureSession(session);
            return addGroupLogic(groupId, groupName, session.getAssociatedFabric(), endpoint.getId());
        },

        viewGroup: async ({ request: { groupId }, session, endpoint }) => {
            if (groupId < 1) {
                return { status: StatusCode.ConstraintError, groupId, groupName: "" };
            }

            assertSecureSession(session);
            const groupName = GroupsManager.getGroupName(session.getAssociatedFabric(), endpoint.getId(), groupId);
            if (groupName !== undefined) {
                return { status: StatusCode.Success, groupId, groupName: groupName };
            }
            return { status: StatusCode.NotFound, groupId, groupName: "" };
        },

        getGroupMembership: async ({ request: { groupList }, session, endpoint }) => {
            // TODO Later:
            //  Zigbee: If the total number of groups will cause the maximum payload length of a frame to be exceeded,
            //  then the GroupList field SHALL contain only as many groups as will fit.

            assertSecureSession(session);
            const endpointGroups = GroupsManager.getGroups(session.getAssociatedFabric(), endpoint.getId());
            const fabricGroupsList = Array.from(endpointGroups.keys());
            const capacity = fabricGroupsList.length < 0xff ? 0xfe - fabricGroupsList.length : 0;
            if (groupList.length === 0) {
                return { capacity, groupList: fabricGroupsList };
            }
            const filteredGroupsList = groupList.filter(groupId => endpointGroups.get(groupId));
            if (filteredGroupsList.length === 0) {
                return { capacity, groupList: [] };
            }
            return { capacity, groupList: filteredGroupsList };
        },

        removeGroup: async ({ request: { groupId }, session, endpoint }) => {
            if (groupId < 1) {
                return { status: StatusCode.ConstraintError, groupId };
            }

            assertSecureSession(session);
            const fabric = session.getAssociatedFabric();
            if (GroupsManager.removeGroup(session.getAssociatedFabric(), endpoint.getId(), groupId)) {
                ScenesManager.removeAllScenesForGroup(fabric, endpoint.getId(), groupId);
                return { status: StatusCode.Success, groupId };
            }
            return { status: StatusCode.NotFound, groupId };
        },

        removeAllGroups: async ({ session, endpoint }) => {
            assertSecureSession(session);
            const fabric = session.getAssociatedFabric();
            GroupsManager.removeAllGroups(fabric, endpoint.getId());
            ScenesManager.removeAllNonGlobalScenesForEndpoint(fabric, endpoint.getId());

            return;
        },

        addGroupIfIdentifying: async ({ request: { groupId, groupName }, session, endpoint }) => {
            const identifyCluster = endpoint.getClusterServer(IdentifyCluster);
            if (identifyCluster) {
                if (identifyCluster.attributes.identifyTime.getLocal() > 0) {
                    // We identify ourselves currently
                    assertSecureSession(session);
                    addGroupLogic(groupId, groupName, session.getAssociatedFabric(), endpoint.getId());
                }
            }

            // TODO If the AddGroupIfIdentifying command was received as unicast and the evaluated status is not SUCCESS, or
            //      if the AddGroupIfIdentifying command was received as unicast and the evaluated status is SUCCESS and a
            //      response is not suppressed, the server SHALL generate a response with the Status field set to the
            //      evaluated status.
        },
    };
};

export const createDefaultGroupsClusterServer = () =>
    ClusterServer(
        GroupsCluster,
        {
            nameSupport: {
                nameSupport: true,
            },
        },
        GroupsClusterHandler(),
    );
