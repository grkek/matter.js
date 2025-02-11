/**
 * @license
 * Copyright 2022 The matter.js Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { MatterDevice } from "./MatterDevice.js";
import { MatterNode } from "./MatterNode.js";
import { Ble } from "./ble/Ble.js";
import { AttestationCertificateManager } from "./certificate/AttestationCertificateManager.js";
import { CertificationDeclarationManager } from "./certificate/CertificationDeclarationManager.js";
import { Attributes, Cluster, Commands, Events } from "./cluster/Cluster.js";
import { ClusterClientObj } from "./cluster/client/ClusterClientTypes.js";
import { AccessControlCluster } from "./cluster/definitions/AccessControlCluster.js";
import {
    AdministratorCommissioning,
    AdministratorCommissioningCluster,
} from "./cluster/definitions/AdministratorCommissioningCluster.js";
import { BasicInformationCluster } from "./cluster/definitions/BasicInformationCluster.js";
import {
    GeneralCommissioning,
    GeneralCommissioningCluster,
} from "./cluster/definitions/GeneralCommissioningCluster.js";
import { GeneralDiagnostics, GeneralDiagnosticsCluster } from "./cluster/definitions/GeneralDiagnosticsCluster.js";
import { GroupKeyManagementCluster } from "./cluster/definitions/GroupKeyManagementCluster.js";
import { OperationalCredentialsCluster } from "./cluster/definitions/OperationalCredentialsCluster.js";
import { AdministratorCommissioningHandler } from "./cluster/server/AdministratorCommissioningServer.js";
import { ClusterServer } from "./cluster/server/ClusterServer.js";
import {
    AttributeInitialValues,
    ClusterServerHandlers,
    ClusterServerObj,
} from "./cluster/server/ClusterServerTypes.js";
import { GeneralCommissioningClusterHandler } from "./cluster/server/GeneralCommissioningServer.js";
import { GroupKeyManagementClusterHandler } from "./cluster/server/GroupKeyManagementServer.js";
import {
    OperationalCredentialsClusterHandler,
    OperationalCredentialsServerConf,
} from "./cluster/server/OperationalCredentialsServer.js";
import { ImplementationError, NoProviderError } from "./common/MatterError.js";
import { Crypto } from "./crypto/Crypto.js";
import { DeviceTypeId } from "./datatype/DeviceTypeId.js";
import { EndpointNumber } from "./datatype/EndpointNumber.js";
import { FabricIndex } from "./datatype/FabricIndex.js";
import { VendorId } from "./datatype/VendorId.js";
import { Aggregator } from "./device/Aggregator.js";
import { Device, RootEndpoint } from "./device/Device.js";
import { Endpoint } from "./device/Endpoint.js";
import { Fabric } from "./fabric/Fabric.js";
import { Logger } from "./log/Logger.js";
import { MdnsBroadcaster } from "./mdns/MdnsBroadcaster.js";
import { MdnsInstanceBroadcaster } from "./mdns/MdnsInstanceBroadcaster.js";
import { MdnsScanner } from "./mdns/MdnsScanner.js";
import { UdpInterface } from "./net/UdpInterface.js";
import { InteractionServer } from "./protocol/interaction/InteractionServer.js";
import { BitSchema, TypeFromBitSchema, TypeFromPartialBitSchema } from "./schema/BitmapSchema.js";
import {
    CommissionningFlowType,
    DiscoveryCapabilitiesBitmap,
    DiscoveryCapabilitiesSchema,
    ManualPairingCodeCodec,
    QrPairingCodeCodec,
} from "./schema/PairingCodeSchema.js";
import { PaseClient } from "./session/pase/PaseClient.js";
import { MatterCoreSpecificationV1_1 } from "./spec/Specifications.js";
import { StorageContext } from "./storage/StorageContext.js";
import { ByteArray } from "./util/ByteArray.js";
import { NamedHandler } from "./util/NamedHandler.js";

const logger = Logger.get("CommissioningServer");

export const FORBIDDEN_PASSCODES = [
    0, 11111111, 22222222, 33333333, 44444444, 55555555, 66666666, 77777777, 88888888, 99999999, 12345678, 87654321,
];

/**
 * Data model revision used by this implementation
 * Value of 16 means "Matter 1.0/1.1"
 *
 * @see {@link MatterCoreSpecificationV1_1} § 7.1.1
 */
const MATTER_DATAMODEL_VERSION = 16;

/**
 * Represents device pairing information.
 */
export interface DevicePairingInformation {
    manualPairingCode: string;
    qrPairingCode: string;
}

/**
 * Constructor options for a CommissioningServer device
 * Beside the general options it also contains the data for the BasicInformation cluster which is added automatically
 * and allows to override the certificates used for the OperationalCredentials cluster
 */
export interface CommissioningServerOptions {
    /** Port of the server, normally automatically managed. */
    port?: number;

    /** IPv4 listener address, defaults to all interfaces.*/
    listeningAddressIpv4?: string;

    /** IPv6 listener address, defaults to all interfaces.*/
    listeningAddressIpv6?: string;

    /** The device name to be used for the BasicInformation cluster. */
    deviceName: string;

    /** The device type to be used for the BasicInformation cluster. */
    deviceType: number;

    /** The next endpoint ID to be assigned to a new endpoint. */
    nextEndpointId?: number;

    /** The passcode/pin of the device to use for initial commissioning. */
    passcode?: number;

    /** The Discriminator to use for initial commissioning. */
    discriminator?: number;

    /** The Flow type of the Commissioning flow used in announcements. */
    flowType?: CommissionningFlowType;

    /** Optional Vendor specific additional BLE Advertisement data. */
    additionalBleAdvertisementData?: ByteArray;

    /** Should the device directly be announced automatically by the MatterServer of manually via announce(). */
    delayedAnnouncement?: boolean;

    /**
     * Optional maximum subscription interval to use for sending subscription reports. It will be used if not too low
     * and inside the range requested by the connected controller.
     */
    subscriptionMaxIntervalSeconds?: number;

    /**
     * Optional minimum subscription interval to use for sending subscription reports. It will be used when other
     * calculated values are smaller than it. Use this to make sure your device hardware can handle the load and to set
     * limits.
     */
    subscriptionMinIntervalSeconds?: number;

    /**
     * Optional subscription randomization window to use for sending subscription reports. This specifies a window in
     * seconds from which a random part is added to the calculated maximum interval to make sure that devices that get
     * powered on in parallel not all send at the same timepoint.
     */
    subscriptionRandomizationWindowSeconds?: number;

    /**
     * Device details to be used for the BasicInformation cluster. Some of the values are initialized with defaults if
     * not set here.
     */
    basicInformation:
        | {
              vendorId: number;
              vendorName: string;
              productId: number;
              productName: string;
          }
        | AttributeInitialValues<typeof BasicInformationCluster.attributes>;

    /**
     * Vendor specific certificates to be used for the OperationalCredentials cluster. If not set Test certificates
     * (official Chip tool test Root certificate is used) are generated automatically.
     */
    certificates?: OperationalCredentialsServerConf;

    /**
     * Optional configuration for the GeneralCommissioning cluster. If not set the default values are used.
     * Use these options to limit the allowed countries for regulatory configuration.
     */
    generalCommissioning?: Partial<AttributeInitialValues<typeof GeneralCommissioningCluster.attributes>> & {
        allowCountryCodeChange?: boolean; // Default true if not set
        countryCodeWhitelist?: string[]; // Default all countries are allowed
    };

    /**
     * This callback is called when the device is commissioned or decommissioned to a fabric/controller. The provided
     * fabricIndex can be used together with getCommissionedFabricInformation() to get more details about the fabric
     * (or if this fabricIndex is missing it was deleted).
     */
    commissioningChangedCallback?: (fabricIndex: FabricIndex) => void;

    /**
     * This callback is called when sessions to the device are established, closed or subscriptions get added or
     * removed. The provided fabricIndex can be used together with getActiveSessionInformation() to get more details
     * about the open sessions and their status.
     */
    activeSessionsChangedCallback?: (fabricIndex: FabricIndex) => void;
}

/**
 * Commands exposed by the CommissioningServer
 */
type CommissioningServerCommands = {
    /** Provide a means for certification tests to trigger some test-plan-specific events. */
    testEventTrigger: ClusterServerHandlers<typeof GeneralDiagnosticsCluster>["testEventTrigger"];
};

// TODO decline using set/getRootClusterClient
// TODO Decline cluster access after announced/paired

/**
 * A CommissioningServer node represent a matter node that can be paired with a controller and runs on a defined port on the
 * host
 */
export class CommissioningServer extends MatterNode {
    private ipv4Disabled?: boolean;
    private port?: number;
    private readonly passcode: number;
    private readonly discriminator: number;
    private readonly flowType: CommissionningFlowType;

    private storage?: StorageContext;
    private endpointStructureStorage?: StorageContext;
    private mdnsScanner?: MdnsScanner;
    private mdnsInstanceBroadcaster?: MdnsInstanceBroadcaster;

    private deviceInstance?: MatterDevice;
    private interactionServer?: InteractionServer;

    protected readonly rootEndpoint = new RootEndpoint();

    private nextEndpointId: EndpointNumber;

    readonly delayedAnnouncement?: boolean;

    private readonly commandHandler = new NamedHandler<CommissioningServerCommands>();

    /**
     * Creates a new CommissioningServer node and add all needed Root clusters
     *
     * @param options The options for the CommissioningServer node
     */
    constructor(private readonly options: CommissioningServerOptions) {
        super();
        const {
            port,
            passcode,
            discriminator,
            flowType,
            nextEndpointId,
            delayedAnnouncement,
            basicInformation: { vendorId: vendorIdNumber, productId },
            generalCommissioning,
        } = options;
        this.port = port;
        if (passcode !== undefined && FORBIDDEN_PASSCODES.includes(passcode)) {
            throw new ImplementationError(`Passcode ${passcode} is not allowed.`);
        }
        this.passcode = passcode ?? PaseClient.generateRandomPasscode();
        this.discriminator = discriminator ?? PaseClient.generateRandomDiscriminator();
        this.flowType = flowType ?? CommissionningFlowType.Standard;
        this.nextEndpointId = EndpointNumber(nextEndpointId ?? 1);
        this.delayedAnnouncement = delayedAnnouncement;

        const vendorId = VendorId(vendorIdNumber);

        // Set the required basicInformation and respect the provided values
        // TODO Get the defaults from the cluster meta details
        const basicInformationAttributes = Object.assign(
            {
                dataModelRevision: MATTER_DATAMODEL_VERSION,
                nodeLabel: "",
                hardwareVersion: 0,
                hardwareVersionString: "0",
                location: "XX",
                localConfigDisabled: false,
                softwareVersion: 1,
                softwareVersionString: "v1",
                capabilityMinima: {
                    caseSessionsPerFabric: 3, // TODO get that limit from Sessionmanager or such or sync with it, add limit?
                    subscriptionsPerFabric: 3, // TODO get that limit from Interactionserver? Respect it?
                },
                serialNumber: `node-matter-${Crypto.get().getRandomData(4).toHex()}`,
            },
            options.basicInformation,
        ) as AttributeInitialValues<typeof BasicInformationCluster.attributes>;

        const reachabilitySupported = basicInformationAttributes.reachable !== undefined;
        // Add basic Information cluster to root directly because it is not allowed to be changed afterward
        const basicInformationCluster = ClusterServer(
            BasicInformationCluster,
            basicInformationAttributes,
            {},
            {
                startUp: true,
                shutDown: true,
                reachableChanged: reachabilitySupported,
                leave: true,
            },
        );
        this.rootEndpoint.addClusterServer(basicInformationCluster);

        if (reachabilitySupported) {
            basicInformationCluster.subscribeReachableAttribute(newValue =>
                basicInformationCluster.triggerReachableChangedEvent?.({ reachableNewValue: newValue }),
            );
        }

        // Use provided certificates for OperationalCredentialsCluster or generate own ones
        let { certificates } = options;
        if (certificates == undefined) {
            const paa = new AttestationCertificateManager(vendorId);
            const { keyPair: dacKeyPair, dac } = paa.getDACert(productId);
            const certificationDeclaration = CertificationDeclarationManager.generate(vendorId, productId);

            certificates = {
                devicePrivateKey: dacKeyPair.privateKey,
                deviceCertificate: dac,
                deviceIntermediateCertificate: paa.getPAICert(),
                certificationDeclaration,
            };
        }

        // Add Operational credentials cluster to root directly because it is not allowed to be changed afterward
        // TODO Get the defaults from the cluster meta details
        this.rootEndpoint.addClusterServer(
            ClusterServer(
                OperationalCredentialsCluster,
                {
                    nocs: [],
                    fabrics: [],
                    supportedFabrics: 254, // maximum number of fabrics. Also FabricBuilder uses 254 as max!
                    commissionedFabrics: 0,
                    trustedRootCertificates: [],
                    currentFabricIndex: FabricIndex.NO_FABRIC,
                },
                OperationalCredentialsClusterHandler(certificates),
            ),
        );

        // TODO Get the defaults from the cluster meta details
        this.rootEndpoint.addClusterServer(
            ClusterServer(
                GeneralCommissioningCluster,
                {
                    breadcrumb: generalCommissioning?.breadcrumb ?? BigInt(0),
                    basicCommissioningInfo: generalCommissioning?.basicCommissioningInfo ?? {
                        failSafeExpiryLengthSeconds: 60 /* 1min */,
                        maxCumulativeFailsafeSeconds: 900 /* Recommended according to Specs */,
                    },
                    regulatoryConfig:
                        generalCommissioning?.regulatoryConfig ?? GeneralCommissioning.RegulatoryLocationType.Outdoor, // Default is the most restrictive one
                    locationCapability:
                        generalCommissioning?.locationCapability ??
                        GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor,
                    supportsConcurrentConnection: generalCommissioning?.supportsConcurrentConnection ?? true,
                },
                GeneralCommissioningClusterHandler({
                    allowCountryCodeChange: generalCommissioning?.allowCountryCodeChange ?? true,
                    countryCodeWhitelist: generalCommissioning?.countryCodeWhitelist ?? undefined,
                }),
            ),
        );

        // TODO Get the defaults from the cluster meta details
        this.rootEndpoint.addClusterServer(
            ClusterServer(
                AccessControlCluster,
                {
                    acl: [],
                    extension: [],
                    subjectsPerAccessControlEntry: 4,
                    targetsPerAccessControlEntry: 4,
                    accessControlEntriesPerFabric: 4,
                },
                {},
                {
                    accessControlEntryChanged: true, // TODO
                    accessControlExtensionChanged: true, // TODO
                },
            ),
        );

        // TODO Get the defaults from the cluster meta details
        this.rootEndpoint.addClusterServer(
            ClusterServer(
                GroupKeyManagementCluster,
                {
                    groupKeyMap: [],
                    groupTable: [],
                    maxGroupsPerFabric: 1, // TODO: Increase once we add group support, for now only IPK is supported
                    maxGroupKeysPerFabric: 1,
                },
                GroupKeyManagementClusterHandler(),
            ),
        );

        // TODO Get the defaults from the cluster meta details
        this.rootEndpoint.addClusterServer(
            ClusterServer(
                GeneralDiagnosticsCluster,
                {
                    networkInterfaces: [],
                    rebootCount: 0,
                    upTime: 0,
                    totalOperationalHours: 0,
                    bootReason: GeneralDiagnostics.BootReason.Unspecified,
                    activeHardwareFaults: [],
                    activeRadioFaults: [],
                    activeNetworkFaults: [],
                    testEventTriggersEnabled: false,
                },
                {
                    testEventTrigger: async args => await this.commandHandler.executeHandler("testEventTrigger", args),
                },
                {
                    bootReason: true,
                },
            ),
        );

        this.rootEndpoint.addClusterServer(
            ClusterServer(
                AdministratorCommissioningCluster,
                {
                    windowStatus: AdministratorCommissioning.CommissioningWindowStatus.WindowNotOpen,
                    adminFabricIndex: null,
                    adminVendorId: null,
                },
                AdministratorCommissioningHandler(),
            ),
        );
    }

    /**
     * Get a cluster server from the root endpoint. This is mainly used internally and not needed to be called by the user.
     *
     * @param cluster ClusterServer to get or undefined if not existing
     */
    getRootClusterServer<
        F extends BitSchema,
        SF extends TypeFromPartialBitSchema<F>,
        A extends Attributes,
        C extends Commands,
        E extends Events,
    >(cluster: Cluster<F, SF, A, C, E>): ClusterServerObj<A, E> | undefined {
        return this.rootEndpoint.getClusterServer(cluster);
    }

    /**
     * Add a cluster client to the root endpoint. This is mainly used internally and not needed to be called by the user.
     *
     * @param cluster ClusterClient object to add
     */
    addRootClusterClient<F extends BitSchema, A extends Attributes, C extends Commands, E extends Events>(
        cluster: ClusterClientObj<F, A, C, E>,
    ) {
        this.rootEndpoint.addClusterClient(cluster);
    }

    /**
     * Get a cluster client from the root endpoint. This is mainly used internally and not needed to be called by the user.
     *
     * @param cluster ClusterClient to get or undefined if not existing
     */
    getRootClusterClient<
        F extends BitSchema,
        SF extends TypeFromPartialBitSchema<F>,
        A extends Attributes,
        C extends Commands,
        E extends Events,
    >(cluster: Cluster<F, SF, A, C, E>): ClusterClientObj<F, A, C, E> | undefined {
        return this.rootEndpoint.getClusterClient(cluster);
    }

    /**
     * Get the root endpoint of the node.
     */
    getRootEndpoint() {
        return this.rootEndpoint;
    }

    /**
     * Add a child endpoint to the root endpoint. This is mainly used internally and not needed to be called by the user.
     *
     * @param endpoint Endpoint to add
     * @protected
     */
    protected addEndpoint(endpoint: Endpoint) {
        this.rootEndpoint.addChildEndpoint(endpoint);
    }

    /**
     * Get a child endpoint from the root endpoint. This is mainly used internally and not needed to be called by the user.
     *
     * @param endpointId Endpoint ID of the child endpoint to get
     * @protected
     */
    protected getChildEndpoint(endpointId: EndpointNumber): Endpoint | undefined {
        return this.rootEndpoint.getChildEndpoint(endpointId);
    }

    /**
     * Add a new cluster server to the root endpoint
     * BasicInformationCluster and OperationalCredentialsCluster can not be added via this method because they are
     * added in the constructor
     *
     * @param cluster
     */
    addRootClusterServer<A extends Attributes, E extends Events>(cluster: ClusterServerObj<A, E>) {
        if (cluster.id === BasicInformationCluster.id) {
            throw new ImplementationError(
                "BasicInformationCluster can not be modified, provide all details in constructor options!",
            );
        }
        if (cluster.id === OperationalCredentialsCluster.id) {
            throw new ImplementationError(
                "OperationalCredentialsCluster can not be modified, provide the certificates in constructor options!",
            );
        }
        this.rootEndpoint.addClusterServer(cluster);
    }

    /**
     * Advertise the node via all available interfaces (Ethernet/MDNS, BLE, ...) and start the commissioning process
     *
     * @param limitTo Limit the advertisement to the given discovery capabilities. Default is to advertise on ethernet
     *                and BLE if configured
     */
    async advertise(limitTo?: TypeFromPartialBitSchema<typeof DiscoveryCapabilitiesBitmap>) {
        if (
            this.mdnsInstanceBroadcaster === undefined ||
            this.mdnsScanner === undefined ||
            this.storage === undefined ||
            this.endpointStructureStorage === undefined ||
            this.port === undefined
        ) {
            throw new ImplementationError("Add the node to the Matter instance before!");
        }

        if (this.interactionServer !== undefined && this.deviceInstance !== undefined) {
            logger.debug("Device already initialized, just advertise the instance again ...");
            await this.deviceInstance.announce();
            return;
        }

        const basicInformation = this.getRootClusterServer(BasicInformationCluster);
        if (basicInformation == undefined) {
            throw new ImplementationError("BasicInformationCluster needs to be set!");
        }
        const vendorId = basicInformation.attributes.vendorId.getLocal();
        const productId = basicInformation.attributes.productId.getLocal();

        this.interactionServer = new InteractionServer(this.storage, {
            subscriptionMaxIntervalSeconds: this.options.subscriptionMaxIntervalSeconds,
            subscriptionMinIntervalSeconds: this.options.subscriptionMinIntervalSeconds,
            subscriptionRandomizationWindowSeconds: this.options.subscriptionRandomizationWindowSeconds,
        });

        this.nextEndpointId = this.endpointStructureStorage.get("nextEndpointId", this.nextEndpointId);

        this.assignEndpointIds(); // Make sure to have unique endpoint ids
        this.rootEndpoint.updatePartsList(); // initialize parts list of all Endpoint objects with final IDs
        this.rootEndpoint.setStructureChangedCallback(() => this.updateStructure()); // Make sure we get structure changes
        this.interactionServer.setRootEndpoint(this.rootEndpoint); // Initialize the interaction server with the root endpoint

        // TODO adjust later and refactor MatterDevice
        this.deviceInstance = new MatterDevice(
            this.options.deviceName,
            DeviceTypeId(this.options.deviceType),
            vendorId,
            productId,
            this.discriminator,
            this.passcode,
            this.storage,
            (fabricIndex: FabricIndex) => {
                const fabricsCount = this.deviceInstance?.getFabrics().length ?? 0;
                if (fabricsCount === 1) {
                    // When first Fabric is added (aka initial commissioning) and we did not advertised on MDNS before, add broadcaster now
                    // TODO Refactor this out when we remove MatterDevice class
                    if (
                        this.mdnsInstanceBroadcaster !== undefined &&
                        !this.deviceInstance?.hasBroadcaster(this.mdnsInstanceBroadcaster)
                    ) {
                        this.deviceInstance?.addBroadcaster(this.mdnsInstanceBroadcaster);
                    }
                }
                if (fabricsCount === 0) {
                    // When last fabric gets deleted we do a factory reset
                    this.factoryReset()
                        .then(() => this.options.commissioningChangedCallback?.(fabricIndex))
                        .catch(error => logger.error("Error while doing factory reset of the device", error));
                } else {
                    this.options.commissioningChangedCallback?.(fabricIndex);
                }
            },
            (fabricIndex: FabricIndex) => this.options.activeSessionsChangedCallback?.(fabricIndex),
        )
            .addTransportInterface(await UdpInterface.create("udp6", this.port, this.options.listeningAddressIpv6))
            .addScanner(this.mdnsScanner)
            .addProtocolHandler(this.interactionServer);
        if (!this.ipv4Disabled) {
            this.deviceInstance.addTransportInterface(
                await UdpInterface.create("udp4", this.port, this.options.listeningAddressIpv4),
            );
        }

        if (this.isCommissioned()) {
            limitTo = { onIpNetwork: true }; // If already commissioned the device is on network already
        } else {
            // BLE or SoftAP only relevant when not commissioned yet
            try {
                const ble = Ble.get();
                this.deviceInstance.addTransportInterface(ble.getBlePeripheralInterface());
                if (limitTo === undefined || limitTo.ble) {
                    this.deviceInstance.addBroadcaster(
                        ble.getBleBroadcaster(this.options.additionalBleAdvertisementData),
                    );
                }
            } catch (error) {
                if (error instanceof NoProviderError) {
                    logger.debug("Ble not enabled");
                } else {
                    throw error;
                }
            }

            if (limitTo?.softAccessPoint) {
                logger.error("Advertising as SoftAP not implemented yet. Ignoring ...");
            }
        }

        if (limitTo === undefined || limitTo.onIpNetwork) {
            this.deviceInstance.addBroadcaster(this.mdnsInstanceBroadcaster);
        }

        await this.deviceInstance.start();

        // Send required events
        basicInformation.triggerStartUpEvent({ softwareVersion: basicInformation.getSoftwareVersionAttribute() });

        const generalDiagnostics = this.getRootClusterServer(GeneralDiagnosticsCluster);
        if (generalDiagnostics !== undefined) {
            this.getRootClusterServer(GeneralDiagnosticsCluster)?.triggerBootReasonEvent({
                bootReason: generalDiagnostics.getBootReasonAttribute?.() ?? GeneralDiagnostics.BootReason.Unspecified,
            });
        }
    }

    updateStructure() {
        logger.debug("Endpoint structure got updated ...");
        this.assignEndpointIds(); // Make sure to have unique endpoint ids
        this.rootEndpoint.updatePartsList(); // update parts list of all Endpoint objects with final IDs
        this.interactionServer?.setRootEndpoint(this.rootEndpoint); // Reinitilize the interaction server structure
    }

    getNextEndpointId(increase = true) {
        if (increase) {
            this.nextEndpointId++;
        }
        return this.nextEndpointId;
    }

    assignEndpointIds() {
        const rootUniqueIdPrefix = this.rootEndpoint.determineUniqueID();
        this.initializeEndpointIdsFromStorage(this.rootEndpoint, rootUniqueIdPrefix);
        this.fillAndStoreEndpointIds(this.rootEndpoint, rootUniqueIdPrefix);
        this.endpointStructureStorage?.set("nextEndpointId", this.nextEndpointId);
    }

    private initializeEndpointIdsFromStorage(endpoint: Endpoint, parentUniquePrefix = "") {
        if (this.endpointStructureStorage === undefined) {
            throw new ImplementationError("Storage manager must be initialized to enable initialization from storage.");
        }
        const endpoints = endpoint.getChildEndpoints();
        for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex++) {
            let endpointUniquePrefix = parentUniquePrefix;
            const endpoint = endpoints[endpointIndex];
            const thisUniqueId = endpoint.determineUniqueID();
            if (thisUniqueId === undefined) {
                if (endpoint.id === undefined) {
                    logger.debug(
                        `No unique id found for endpoint on index ${endpointIndex} / device ${endpoint.name} - using index as unique identifier!`,
                    );
                }
                endpointUniquePrefix += `${endpointUniquePrefix === "" ? "" : "-"}index_${endpointIndex}`;
            } else {
                endpointUniquePrefix += `${endpointUniquePrefix === "" ? "" : "-"}${thisUniqueId}`;
            }

            if (endpoint.id === undefined) {
                if (this.endpointStructureStorage.has(endpointUniquePrefix)) {
                    endpoint.id = this.endpointStructureStorage.get<EndpointNumber>(endpointUniquePrefix);
                    logger.debug(
                        `Restored endpoint id ${endpoint.id} for endpoint with ${endpointUniquePrefix} / device ${endpoint.name} from storage`,
                    );
                }
            }
            if (endpoint.id !== undefined && endpoint.id > this.nextEndpointId) {
                this.nextEndpointId = EndpointNumber(endpoint.id + 1);
            }
            this.initializeEndpointIdsFromStorage(endpoint, endpointUniquePrefix);
        }
    }

    private fillAndStoreEndpointIds(endpoint: Endpoint, parentUniquePrefix = "") {
        if (this.endpointStructureStorage === undefined) {
            throw new ImplementationError("endpointStructureStorage not set!");
        }
        const endpoints = endpoint.getChildEndpoints();
        for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex++) {
            let endpointUniquePrefix = parentUniquePrefix;
            endpoint = endpoints[endpointIndex];
            const thisUniqueId = endpoint.determineUniqueID();
            if (thisUniqueId === undefined) {
                endpointUniquePrefix += `${endpointUniquePrefix === "" ? "" : "-"}index_${endpointIndex}`;
            } else {
                endpointUniquePrefix += `${endpointUniquePrefix === "" ? "" : "-"}${thisUniqueId}`;
            }

            if (endpoint.id === undefined) {
                endpoint.id = EndpointNumber(this.nextEndpointId++);
                this.endpointStructureStorage.set(endpointUniquePrefix, endpoint.id);
                logger.debug(
                    `Assigned endpoint id ${endpoint.id} for endpoint with ${endpointUniquePrefix} / device ${endpoint.name} and stored it`,
                );
            }
            this.fillAndStoreEndpointIds(endpoint, endpointUniquePrefix);
        }
    }

    /**
     * Return info if the device is paired with at least one controller
     */
    isCommissioned(): boolean {
        return this.deviceInstance?.isCommissioned() ?? false;
    }

    /**
     * Return the pairing information for the device
     */
    getPairingCode(
        discoveryCapabilities?: TypeFromBitSchema<typeof DiscoveryCapabilitiesBitmap>,
    ): DevicePairingInformation {
        const basicInformation = this.getRootClusterServer(BasicInformationCluster);
        if (basicInformation == undefined) {
            throw new ImplementationError("BasicInformationCluster needs to be set!");
        }

        const vendorId = basicInformation.attributes.vendorId.getLocal();
        const productId = basicInformation.attributes.productId.getLocal();

        let bleEnabled = false;
        try {
            bleEnabled = !!Ble.get();
        } catch (error) {
            if (!(error instanceof NoProviderError)) {
                // only ignore NoProviderError cases
                throw error;
            }
        }

        const qrPairingCode = QrPairingCodeCodec.encode({
            version: 0,
            vendorId: vendorId,
            productId,
            flowType: this.flowType,
            discriminator: this.discriminator,
            passcode: this.passcode,
            discoveryCapabilities: DiscoveryCapabilitiesSchema.encode(
                discoveryCapabilities ?? {
                    ble: bleEnabled,
                    softAccessPoint: false,
                    onIpNetwork: true,
                },
            ),
        });

        return {
            manualPairingCode: ManualPairingCodeCodec.encode({
                discriminator: this.discriminator,
                passcode: this.passcode,
            }),
            qrPairingCode,
        };
    }

    /**
     * Set the MDNS Scanner instance. Should be only used internally
     *
     * @param mdnsScanner MdnsScanner instance
     */
    setMdnsScanner(mdnsScanner: MdnsScanner) {
        this.mdnsScanner = mdnsScanner;
    }

    /**
     * Set the MDNS Broadcaster instance. Should be only used internally
     *
     * @param mdnsBroadcaster MdnsBroadcaster instance
     */
    setMdnsBroadcaster(mdnsBroadcaster: MdnsBroadcaster) {
        if (this.port === undefined) {
            throw new ImplementationError("Port must be set before setting the MDNS broadcaster!");
        }
        this.mdnsInstanceBroadcaster = new MdnsInstanceBroadcaster(this.port, mdnsBroadcaster);
    }

    /**
     * Set the StorageManager instance. Should be only used internally
     * @param storage
     */
    setStorage(storage: StorageContext) {
        this.storage = storage;
        this.endpointStructureStorage = this.storage.createContext("EndpointStructure");
    }

    /**
     * Add a new device to the node
     *
     * @param device Device or Aggregator instance to add
     */
    addDevice(device: Device | Aggregator) {
        this.addEndpoint(device);
    }

    /**
     * Return the port the device is listening on
     */
    getPort(): number | undefined {
        return this.port;
    }

    /** Set the port the device is listening on. Can only be called before the device is initialized. */
    setPort(port: number) {
        if (port === this.port) return;
        if (this.deviceInstance !== undefined || this.mdnsInstanceBroadcaster !== undefined) {
            throw new ImplementationError("Port can not be changed after device is initialized!");
        }
        this.port = port;
    }

    /**
     * Close network connections of the device and stop responding to requests
     */
    async close() {
        this.rootEndpoint.getClusterServer(BasicInformationCluster)?.triggerShutDownEvent?.();
        await this.interactionServer?.close();
        this.interactionServer = undefined;
        await this.deviceInstance?.stop();
        this.deviceInstance = undefined;
    }

    async factoryReset() {
        if (this.storage === undefined) {
            throw new ImplementationError(
                "Storage not initialized. The instance was not added to a Matter instance yet.",
            );
        }
        const wasStarted = this.interactionServer !== undefined || this.deviceInstance !== undefined;
        let fabrics = new Array<Fabric>();
        if (wasStarted) {
            fabrics = this.isCommissioned() ? this.deviceInstance?.getFabrics() ?? [] : [];
            await this.close();
        }

        this.storage.clearAll();

        if (wasStarted) {
            await this.advertise();
            fabrics.forEach(fabric => this.options.commissioningChangedCallback?.(fabric.fabricIndex));
        }
        logger.info(`The device was factory reset${wasStarted ? " and restarted" : ""}.`);
    }

    /**
     * Add a new command handler for the given command
     *
     * @param command Command to add the handler for
     * @param handler Handler function to add
     */
    addCommandHandler<K extends keyof CommissioningServerCommands>(
        command: K,
        handler: CommissioningServerCommands[K],
    ) {
        this.commandHandler.addHandler(command, handler);
    }

    /**
     * Remove a command handler for the given command
     *
     * @param command Command to remove the handler for
     * @param handler Handler function to remove
     */
    removeCommandHandler<K extends keyof CommissioningServerCommands>(
        command: K,
        handler: CommissioningServerCommands[K],
    ) {
        this.commandHandler.removeHandler(command, handler);
    }

    /**
     * Set the reachability of the commissioning server aka "the main matter device". This call only has effect when
     * the reachability flag was set in the BasicInformationCluster or in the BasicInformation data in the constructor!
     *
     * @param reachable true if reachable, false otherwise
     */
    setReachability(reachable: boolean) {
        const basicInformationCluster = this.getRootClusterServer(BasicInformationCluster);
        if (basicInformationCluster === undefined) {
            throw new ImplementationError("BasicInformationCluster needs to be set!");
        }
        if (basicInformationCluster.attributes.reachable !== undefined) {
            basicInformationCluster.setReachableAttribute(reachable);
        }
    }

    /** used internally by MatterServer to initialize the state of the device. */
    initialize(ipv4Disabled: boolean) {
        if (this.ipv4Disabled !== undefined && this.ipv4Disabled !== ipv4Disabled) {
            throw new ImplementationError(
                "Changing the IPv4 disabled flag after starting the device is not supported.",
            );
        }
        this.ipv4Disabled = ipv4Disabled;
    }

    /** Starts the Matter device and advertises it. */
    async start() {
        if (this.ipv4Disabled === undefined) {
            throw new ImplementationError("Add the device to the MatterServer first.");
        }
        if (this.delayedAnnouncement !== true) {
            return this.advertise();
        }
    }

    /**
     * Get some basic details of all Fabrics the server is commissioned to.
     *
     * @param fabricIndex Optional fabric index to filter for. If not set all fabrics are returned.
     */
    getCommissionedFabricInformation(fabricIndex?: FabricIndex) {
        if (!this.isCommissioned()) return [];
        const allFabrics = this.deviceInstance?.getFabrics() ?? [];
        const fabrics = fabricIndex === undefined ? allFabrics : allFabrics.filter(f => f.fabricIndex === fabricIndex);
        return fabrics.map(fabric => fabric.getExternalInformation()) ?? [];
    }

    /**
     * Get some basic details of all currently active sessions.
     *
     * @param fabricIndex Optional fabric index to filter for. If not set all sessions are returned.
     */
    getActiveSessionInformation(fabricIndex?: FabricIndex) {
        if (!this.isCommissioned()) return [];
        const allSessions = this.deviceInstance?.getActiveSessionInformation() ?? [];
        return allSessions.filter(({ fabric }) => fabricIndex === undefined || fabric?.fabricIndex === fabricIndex);
    }
}
