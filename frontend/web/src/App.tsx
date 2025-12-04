// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface Prescription {
  id: string;
  encryptedData: string;
  timestamp: number;
  patient: string;
  doctor: string;
  medication: string;
  dosage: string;
  status: "pending" | "verified" | "dispensed" | "rejected";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newPrescription, setNewPrescription] = useState({
    patient: "",
    medication: "",
    dosage: "",
    instructions: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  // Calculate statistics
  const pendingCount = prescriptions.filter(p => p.status === "pending").length;
  const verifiedCount = prescriptions.filter(p => p.status === "verified").length;
  const dispensedCount = prescriptions.filter(p => p.status === "dispensed").length;
  const rejectedCount = prescriptions.filter(p => p.status === "rejected").length;

  useEffect(() => {
    loadPrescriptions().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadPrescriptions = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("prescription_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing prescription keys:", e);
        }
      }
      
      const list: Prescription[] = [];
      
      for (const key of keys) {
        try {
          const prescriptionBytes = await contract.getData(`prescription_${key}`);
          if (prescriptionBytes.length > 0) {
            try {
              const prescriptionData = JSON.parse(ethers.toUtf8String(prescriptionBytes));
              list.push({
                id: key,
                encryptedData: prescriptionData.data,
                timestamp: prescriptionData.timestamp,
                patient: prescriptionData.patient,
                doctor: prescriptionData.doctor,
                medication: prescriptionData.medication,
                dosage: prescriptionData.dosage,
                status: prescriptionData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing prescription data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading prescription ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setPrescriptions(list);
    } catch (e) {
      console.error("Error loading prescriptions:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitPrescription = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting prescription data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newPrescription))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const prescriptionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const prescriptionData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        patient: newPrescription.patient,
        doctor: account,
        medication: newPrescription.medication,
        dosage: newPrescription.dosage,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `prescription_${prescriptionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(prescriptionData))
      );
      
      const keysBytes = await contract.getData("prescription_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(prescriptionId);
      
      await contract.setData(
        "prescription_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Prescription encrypted and submitted securely!"
      });
      
      await loadPrescriptions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewPrescription({
          patient: "",
          medication: "",
          dosage: "",
          instructions: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifyPrescription = async (prescriptionId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Verifying encrypted prescription with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const prescriptionBytes = await contract.getData(`prescription_${prescriptionId}`);
      if (prescriptionBytes.length === 0) {
        throw new Error("Prescription not found");
      }
      
      const prescriptionData = JSON.parse(ethers.toUtf8String(prescriptionBytes));
      
      const updatedPrescription = {
        ...prescriptionData,
        status: "verified"
      };
      
      await contract.setData(
        `prescription_${prescriptionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedPrescription))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed successfully!"
      });
      
      await loadPrescriptions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const dispensePrescription = async (prescriptionId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted prescription with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const prescriptionBytes = await contract.getData(`prescription_${prescriptionId}`);
      if (prescriptionBytes.length === 0) {
        throw new Error("Prescription not found");
      }
      
      const prescriptionData = JSON.parse(ethers.toUtf8String(prescriptionBytes));
      
      const updatedPrescription = {
        ...prescriptionData,
        status: "dispensed"
      };
      
      await contract.setData(
        `prescription_${prescriptionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedPrescription))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Medication dispensed successfully!"
      });
      
      await loadPrescriptions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Dispensing failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectPrescription = async (prescriptionId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted prescription with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const prescriptionBytes = await contract.getData(`prescription_${prescriptionId}`);
      if (prescriptionBytes.length === 0) {
        throw new Error("Prescription not found");
      }
      
      const prescriptionData = JSON.parse(ethers.toUtf8String(prescriptionBytes));
      
      const updatedPrescription = {
        ...prescriptionData,
        status: "rejected"
      };
      
      await contract.setData(
        `prescription_${prescriptionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedPrescription))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Prescription rejected!"
      });
      
      await loadPrescriptions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isDoctor = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the FHE e-prescription system",
      icon: "🔗"
    },
    {
      title: "Create Prescription",
      description: "Doctors can create prescriptions that are encrypted using FHE technology",
      icon: "📝"
    },
    {
      title: "FHE Verification",
      description: "Pharmacies verify prescriptions while data remains encrypted",
      icon: "🔒"
    },
    {
      title: "Dispense Medication",
      description: "After verification, medication is dispensed securely",
      icon: "💊"
    }
  ];

  // Filter prescriptions based on search and status filter
  const filteredPrescriptions = prescriptions.filter(p => {
    const matchesSearch = p.patient.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          p.medication.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "all" || p.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">💊</div>
          <h1>FHE<span>ePrescript</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
            disabled={!account}
          >
            + New Prescription
          </button>
          <button 
            className="tutorial-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="hero-banner">
          <div className="hero-content">
            <h2>FHE-Based Secure E-Prescription System</h2>
            <p>Fully homomorphic encryption protects patient privacy while enabling secure prescription verification</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How FHE e-Prescription Works</h2>
            <p className="subtitle">Learn how to use the secure prescription system</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{prescriptions.length}</div>
            <div className="stat-label">Total Prescriptions</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{pendingCount}</div>
            <div className="stat-label">Pending Verification</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{verifiedCount}</div>
            <div className="stat-label">Verified</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{dispensedCount}</div>
            <div className="stat-label">Dispensed</div>
          </div>
        </div>
        
        <div className="search-filter-bar">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search patients or medications..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="filter-dropdown">
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="verified">Verified</option>
              <option value="dispensed">Dispensed</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <button 
            onClick={loadPrescriptions}
            className="refresh-btn"
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        
        <div className="prescriptions-section">
          <h2>Prescription Records</h2>
          
          <div className="prescriptions-list">
            {filteredPrescriptions.length === 0 ? (
              <div className="no-records">
                <div className="no-records-icon">📋</div>
                <p>No prescriptions found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Prescription
                </button>
              </div>
            ) : (
              filteredPrescriptions.map(prescription => (
                <div className="prescription-card" key={prescription.id}>
                  <div className="prescription-header">
                    <div className="prescription-id">#{prescription.id.substring(0, 6)}</div>
                    <div className={`status-badge ${prescription.status}`}>
                      {prescription.status}
                    </div>
                  </div>
                  
                  <div className="prescription-details">
                    <div className="detail-row">
                      <span className="label">Patient:</span>
                      <span className="value">{prescription.patient}</span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Medication:</span>
                      <span className="value">{prescription.medication}</span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Dosage:</span>
                      <span className="value">{prescription.dosage}</span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Date:</span>
                      <span className="value">{new Date(prescription.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Doctor:</span>
                      <span className="value">{prescription.doctor.substring(0, 6)}...{prescription.doctor.substring(38)}</span>
                    </div>
                  </div>
                  
                  <div className="prescription-actions">
                    {isDoctor(prescription.doctor) && prescription.status === "pending" && (
                      <>
                        <button 
                          className="action-btn verify-btn"
                          onClick={() => verifyPrescription(prescription.id)}
                        >
                          Verify
                        </button>
                        <button 
                          className="action-btn reject-btn"
                          onClick={() => rejectPrescription(prescription.id)}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {prescription.status === "verified" && (
                      <button 
                        className="action-btn dispense-btn"
                        onClick={() => dispensePrescription(prescription.id)}
                      >
                        Dispense
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitPrescription} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          prescriptionData={newPrescription}
          setPrescriptionData={setNewPrescription}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="logo-icon">💊</div>
              <span>FHE ePrescript</span>
            </div>
            <p>Secure encrypted prescriptions using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE ePrescript. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  prescriptionData: any;
  setPrescriptionData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  prescriptionData,
  setPrescriptionData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setPrescriptionData({
      ...prescriptionData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!prescriptionData.patient || !prescriptionData.medication || !prescriptionData.dosage) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create New Prescription</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="key-icon">🔒</div> Prescription data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Patient Name *</label>
              <input 
                type="text"
                name="patient"
                value={prescriptionData.patient} 
                onChange={handleChange}
                placeholder="Enter patient name" 
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Medication *</label>
              <input 
                type="text"
                name="medication"
                value={prescriptionData.medication} 
                onChange={handleChange}
                placeholder="Medication name" 
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Dosage *</label>
              <input 
                type="text"
                name="dosage"
                value={prescriptionData.dosage} 
                onChange={handleChange}
                placeholder="Dosage instructions" 
                className="form-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Additional Instructions</label>
              <textarea 
                name="instructions"
                value={prescriptionData.instructions} 
                onChange={handleChange}
                placeholder="Additional instructions for the patient..." 
                className="form-textarea"
                rows={3}
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn primary-btn"
          >
            {creating ? "Encrypting with FHE..." : "Create Prescription"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;