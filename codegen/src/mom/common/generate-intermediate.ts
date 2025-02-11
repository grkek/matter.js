/**
 * @license
 * Copyright 2022-2023 Project CHIP Authors
 * SPDX-License-Identifier: Apache-2.0
 */

export const INTERMEDIATE_PATH = "models";

import { Logger } from "@project-chip/matter.js/log";
import { MatterElement, MatterModel } from "@project-chip/matter.js/model";
import { TsFile } from "../../util/TsFile.js";
import { finalizeModel } from "../../util/finalize-model.js";
import { camelize } from "../../util/string.js";
import { generateElement } from "./generate-element.js";

const logger = Logger.get("generate-model");

/**
 * Create a model file containing an imported models.  These are "intermediate"
 * in the sense that they're input to the merge process that generates the
 * final model.
 */
export function generateIntermediateModel(source: string, elements: MatterElement.Child[]) {
    logger.info(`validate ${source}`);
    const matter = new MatterModel({
        name: `${camelize(source)}Matter`,
        children: elements,
    });

    const validationResult = finalizeModel(matter);

    const file = new TsFile(`#intermediate/${source}`);
    file.addImport("@project-chip/matter.js/model", "MatterElement");
    generateElement(file, matter, `export const ${camelize(source)}Matter: MatterElement = `);
    file.save();

    validationResult.report();
}
