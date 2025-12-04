// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ePrescriptFHE is SepoliaConfig {
    struct Prescription {
        euint32 encryptedPatientId;
        euint32 encryptedDoctorId;
        euint32 encryptedMedicationCode;
        euint32 encryptedDosage;
        euint32 encryptedTimestamp;
        bool isFilled;
    }

    struct Pharmacy {
        address wallet;
        bool isAuthorized;
    }

    struct Doctor {
        address wallet;
        bool isAuthorized;
    }

    uint256 public prescriptionCount;
    uint256 public doctorCount;
    uint256 public pharmacyCount;
    mapping(uint256 => Prescription) public prescriptions;
    mapping(uint256 => Doctor) public doctors;
    mapping(uint256 => Pharmacy) public pharmacies;
    mapping(uint256 => uint256) private requestToPrescriptionId;
    
    event PrescriptionIssued(uint256 indexed prescriptionId);
    event PrescriptionFilled(uint256 indexed prescriptionId, uint256 indexed pharmacyId);
    event PrescriptionVerified(uint256 indexed prescriptionId);
    event DoctorRegistered(uint256 indexed doctorId);
    event PharmacyRegistered(uint256 indexed pharmacyId);

    modifier onlyDoctor(uint256 doctorId) {
        require(doctors[doctorId].isAuthorized, "Unauthorized doctor");
        require(doctors[doctorId].wallet == msg.sender, "Not doctor owner");
        _;
    }

    modifier onlyPharmacy(uint256 pharmacyId) {
        require(pharmacies[pharmacyId].isAuthorized, "Unauthorized pharmacy");
        require(pharmacies[pharmacyId].wallet == msg.sender, "Not pharmacy owner");
        _;
    }

    function registerDoctor(address doctorWallet) public {
        doctorCount++;
        doctors[doctorCount] = Doctor({
            wallet: doctorWallet,
            isAuthorized: true
        });
        emit DoctorRegistered(doctorCount);
    }

    function registerPharmacy(address pharmacyWallet) public {
        pharmacyCount++;
        pharmacies[pharmacyCount] = Pharmacy({
            wallet: pharmacyWallet,
            isAuthorized: true
        });
        emit PharmacyRegistered(pharmacyCount);
    }

    function issuePrescription(
        euint32 patientId,
        euint32 doctorId,
        euint32 medicationCode,
        euint32 dosage
    ) public onlyDoctor(uint256(doctorId)) {
        prescriptionCount++;
        prescriptions[prescriptionCount] = Prescription({
            encryptedPatientId: patientId,
            encryptedDoctorId: doctorId,
            encryptedMedicationCode: medicationCode,
            encryptedDosage: dosage,
            encryptedTimestamp: FHE.asEuint32(uint32(block.timestamp)),
            isFilled: false
        });
        emit PrescriptionIssued(prescriptionCount);
    }

    function verifyPrescription(
        uint256 prescriptionId,
        uint256 pharmacyId
    ) public onlyPharmacy(pharmacyId) {
        Prescription storage prescription = prescriptions[prescriptionId];
        require(!prescription.isFilled, "Already filled");

        bytes32[] memory ciphertexts = new bytes32[](4);
        ciphertexts[0] = FHE.toBytes32(prescription.encryptedDoctorId);
        ciphertexts[1] = FHE.toBytes32(prescription.encryptedMedicationCode);
        ciphertexts[2] = FHE.toBytes32(prescription.encryptedDosage);
        ciphertexts[3] = FHE.toBytes32(prescription.encryptedTimestamp);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.validatePrescription.selector);
        requestToPrescriptionId[reqId] = prescriptionId;
    }

    function validatePrescription(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 prescriptionId = requestToPrescriptionId[requestId];
        require(prescriptionId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory prescriptionData = abi.decode(cleartexts, (uint32[]));
        uint32 doctorId = prescriptionData[0];
        uint32 medicationCode = prescriptionData[1];
        uint32 dosage = prescriptionData[2];
        uint32 timestamp = prescriptionData[3];

        // Validate prescription logic
        bool isValid = doctors[doctorId].isAuthorized && 
                      dosage > 0 && 
                      block.timestamp - timestamp < 30 days;

        if (isValid) {
            prescriptions[prescriptionId].isFilled = true;
            emit PrescriptionFilled(prescriptionId, findPharmacyId(msg.sender));
        }

        emit PrescriptionVerified(prescriptionId);
    }

    function requestPatientInfo(uint256 prescriptionId) public {
        Prescription storage prescription = prescriptions[prescriptionId];
        require(prescription.isFilled, "Not filled yet");

        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(prescription.encryptedPatientId);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptPatientInfo.selector);
        requestToPrescriptionId[reqId] = prescriptionId;
    }

    function decryptPatientInfo(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 prescriptionId = requestToPrescriptionId[requestId];
        require(prescriptionId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 patientId = abi.decode(cleartexts, (uint32));
        // Process decrypted patient ID as needed
    }

    function findPharmacyId(address pharmacyWallet) private view returns (uint256) {
        for (uint256 i = 1; i <= pharmacyCount; i++) {
            if (pharmacies[i].wallet == pharmacyWallet) {
                return i;
            }
        }
        revert("Pharmacy not found");
    }

    function getPrescriptionStatus(uint256 prescriptionId) public view returns (bool) {
        return prescriptions[prescriptionId].isFilled;
    }

    function checkDoctorAuthorization(uint256 doctorId) public view returns (bool) {
        return doctors[doctorId].isAuthorized;
    }

    function checkPharmacyAuthorization(uint256 pharmacyId) public view returns (bool) {
        return pharmacies[pharmacyId].isAuthorized;
    }
}